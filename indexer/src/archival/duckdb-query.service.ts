import { Injectable, Logger } from '@nestjs/common';
import { Database } from 'duckdb-async';

@Injectable()
export class DuckDbQueryService {
  private readonly logger = new Logger(DuckDbQueryService.name);

  /**
   * Queries archived S3 Parquet files directly using DuckDB without re-hydrating primary DB.
   */
  async queryArchivedEvents(contractId: string, limit: number = 100): Promise<any[]> {
    const db = await Database.create(':memory:');
    
    try {
      // Install and load S3 spatial / HTTPFS extensions for DuckDB
      await db.run('INSTALL httpfs;');
      await db.run('LOAD httpfs;');
      
      await db.run(`SET s3_region='${process.env.AWS_REGION || 'us-east-1'}';`);
      if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        await db.run(`SET s3_access_key_id='${process.env.AWS_ACCESS_KEY_ID}';`);
        await db.run(`SET s3_secret_access_key='${process.env.AWS_SECRET_ACCESS_KEY}';`);
      }

      const bucketName = process.env.S3_COLD_STORAGE_BUCKET || 'ignition-cold-storage';
      const s3ParquetGlob = `s3://${bucketName}/events/*/*/*.parquet`;

      const rows = await db.all(
        `SELECT id, ledger_sequence, contract_id, event_type, payload, created_at 
         FROM read_parquet(?)
         WHERE contract_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [s3ParquetGlob, contractId, limit],
      );

      return rows;
    } catch (error) {
      this.logger.error('DuckDB query over S3 Parquet archives failed', error);
      throw error;
    }
  }
}