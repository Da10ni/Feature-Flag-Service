import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Tenant } from './entities/tenant.entity';

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

describe('TenantsService', () => {
  let service: TenantsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantsService,
        { provide: getRepositoryToken(Tenant), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<TenantsService>(TenantsService);
  });

  describe('create', () => {
    it('creates a tenant and returns a raw API key', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const tenant = {
        id: 't1',
        name: 'App A',
        slug: 'app-a',
        apiKeyHash: 'hash',
        isActive: true,
        createdAt: new Date(),
      };
      mockRepo.create.mockReturnValue(tenant);
      mockRepo.save.mockResolvedValue(tenant);

      const result = await service.create({ name: 'App A', slug: 'app-a' });
      expect(result.apiKey).toMatch(/^ffs_/);
      expect(result.tenant.name).toBe('App A');
    });

    it('throws ConflictException if tenant already exists', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.create({ name: 'App A', slug: 'app-a' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException if tenant not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns tenant if found', async () => {
      const tenant = { id: 't1', name: 'App A' };
      mockRepo.findOne.mockResolvedValue(tenant);
      const result = await service.findOne('t1');
      expect(result).toEqual(tenant);
    });
  });
});
