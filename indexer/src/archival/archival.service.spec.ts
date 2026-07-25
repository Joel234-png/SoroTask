import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ArchivalService } from './archival.service';

jest.mock('@aws-sdk/client-s3');
jest.mock('parquetjs-lite', () => ({
  ParquetSchema: jest.fn().mockImplementation(() => ({})),
  ParquetWriter: {
    openFile: jest.fn().mockResolvedValue({
      appendRow: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe('ArchivalService', () => {
  let service: ArchivalService;
  let mockQueryRunner: any;

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      isTransactionActive: false,
    };

    const mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArchivalService,
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<ArchivalService>(ArchivalService);
  });

  it('should skip archival when no events older than 90 days exist', async () => {
    mockQueryRunner.query.mockResolvedValueOnce([]);

    await service.archiveHistoricalEvents();

    expect(mockQueryRunner.query).toHaveBeenCalledTimes(1);
    expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
  });
});