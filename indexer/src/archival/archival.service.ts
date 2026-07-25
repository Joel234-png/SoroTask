import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as parquet from 'parquetjs-lite';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ArchivalService {
  private readonly logger = new Logger(ArchivalService.name);
  private readonly s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
  });
  private readonly bucketName = process.env.S3_COLD_STORAGE_BUCKET || 'ignition-cold-storage';

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Weekly Cron job executing Sundays at Midnight (00:00)
   * Archives indexer events older than 90 days to Apache Parquet S3 files.
   */
  @Cron(CronExpression.EVERY_WEEKEND)
  async archiveHistoricalEvents(): Promise<void> {
    this.logger.log('Starting historical event archival pipeline...');

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();

    try {
      // 1. Fetch historical event records targeted for archival
      const eventsToArchive = await queryRunner.query(
        `SELECT id, ledger_sequence, contract_id, event_type, payload, created_at
         FROM indexer_events
         WHERE created_at < $1
         ORDER BY created_at ASC
         LIMIT 50000`,
        [ninetyDaysAgo],
      );

      if (eventsToArchive.length === 0) {
        this.logger.log('No historical events eligible for archival.');
        return;
      }

      this.logger.log(`Found ${eventsToArchive.length} events older than 90 days to archive.`);

      // 2. Generate local Parquet file with snappy compression
      const dateStr = ninetyDaysAgo.toISOString().split('T')[0];
      const tempFileName = `events_archival_${dateStr}_${Date.now()}.parquet`;
      const tempFilePath = path.join('/tmp', tempFileName);

      const schema = new parquet.ParquetSchema({
        id: { type: 'UTF8' },
        ledger_sequence: { type: 'INT64' },
        contract_id: { type: 'UTF8' },
        event_type: { type: 'UTF8' },
        payload: { type: 'UTF8' },
        created_at: { type: 'TIMESTAMP_MILLIS' },
      });

      const writer = await parquet.ParquetWriter.openFile(schema, tempFilePath, {
        compression: 'SNAPPY',
      });

      for (const row of eventsToArchive) {
        await writer.appendRow({
          id: row.id,
          ledger_sequence: BigInt(row.ledger_sequence),
          contract_id: row.contract_id,
          event_type: row.event_type,
          payload: typeof row.payload === 'object' ? JSON.stringify(row.payload) : row.payload,
          created_at: new Date(row.created_at).getTime(),
        });
      }

      await writer.close();

      // 3. Upload generated Parquet archive to AWS S3
      const s3Key = `events/year=${ninetyDaysAgo.getFullYear()}/month=${String(
        ninetyDaysAgo.getMonth() + 1,
      ).padStart(2, '0')}/${tempFileName}`;

      const fileStream = fs.createReadStream(tempFilePath);
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: s3Key,
          Body: fileStream,
          ContentType: 'application/vnd.apache.parquet',
        }),
      );

      this.logger.log(`Successfully uploaded Parquet archive to s3://${this.bucketName}/${s3Key}`);

      // 4. Atomic deletion of archived event rows from primary DB table
      await queryRunner.startTransaction();
      const idsToDelete = eventsToArchive.map((e) => e.id);

      await queryRunner.query(
        `DELETE FROM indexer_events WHERE id = ANY($1::uuid[])`,
        [idsToDelete],
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Pruned ${idsToDelete.length} archived rows from primary database.`);

      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      this.logger.error('Failed to execute event archival pipeline', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}