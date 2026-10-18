/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { Injectable } from '@nestjs/common';

import { BaseOrmService } from '@/utils/generics/base-orm.service';

import { ContentTypeOrmEntity } from '../entities/content-type.entity';
import { ContentTypeRepository } from '../repositories/content-type.repository';

@Injectable()
export class ContentTypeService extends BaseOrmService<ContentTypeOrmEntity> {
  constructor(readonly repository: ContentTypeRepository) {
    super(repository);
  }
}
