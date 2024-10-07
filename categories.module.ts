import { Module } from '@nestjs/common';
import { CategoriesControllerV1 } from './v1/categories.controller';
import { CategoriesServiceV1 } from './v1/categories.service';
import { CategoryModelModule } from '../../models/category-model.module';
import { ProductModelModule } from '../../models/product-model.module';
import { ProductOptionModelModule } from '../../models/product-option-model.module';
import { HelperService } from '../../common/services/helper.service';
import { UtilityService } from '../../common/services/utility.service';
import { FilterModelModule } from '../../models/filter-model.module';
import { ProductAttributeValueModelModule } from '../../models/product-attribute-value-model.module';
import { AttributeModelModule } from '../../models/attribute-model.module';
import { FilterValueModelModule } from '../../models/filter-value-model.module';
import { ProductGalleryModelModule } from '../../models/product-gallery-model.module';

@Module({
  imports: [
    CategoryModelModule,
    ProductModelModule,
    ProductOptionModelModule,
    AttributeModelModule,
    ProductAttributeValueModelModule,
    FilterModelModule,
    FilterValueModelModule,
    ProductGalleryModelModule,
  ],
  controllers: [CategoriesControllerV1],
  providers: [CategoriesServiceV1, HelperService, UtilityService],
})
export class CategoriesModule {}
