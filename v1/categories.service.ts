import { HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { Model } from 'mongoose';
import { ERROR_MESSAGES } from '../../../common/constants/error-messages';
import { InjectModel } from '@nestjs/mongoose';
import { Category, CategoryDocument } from '../../../models/schemas/category.schema';
import { HelperService } from '../../../common/services/helper.service';
import { ExcludeCategoryEnum } from '../../../common/enums/exclude-category.enum';
import { Product, ProductDocument } from "../../../models/schemas/product.schema";
import { ProductOption, ProductOptionDocument } from "../../../models/schemas/product-option.schema";
import { UtilityService } from '../../../common/services/utility.service';
import { Filter, FilterDocument } from '../../../models/schemas/filter.schema';
import { ProductAttributeValue, ProductAttributeValueDocument } from "../../../models/schemas/product-attribute-value.schema";
import { FilterValue, FilterValueDocument } from "../../../models/schemas/filter-value.schema";
import { ProductGallery, ProductGalleryDocument } from "../../../models/schemas/product-gallery.schema";

interface FilterValue {
  name_ua: string;
  attribute_value?: string;
  option_value?: string;
}

@Injectable()
export class CategoriesServiceV1 {
  constructor(
    @InjectModel(Filter.name) private filterModel: Model<FilterDocument>,
    @InjectModel(FilterValue.name) private filterValueModel: Model<FilterValueDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(ProductGallery.name) private productGalleryModel: Model<ProductGalleryDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(ProductOption.name) private productOptionModel: Model<ProductOptionDocument>,
    @InjectModel(ProductAttributeValue.name) private productAttributeValueModel: Model<ProductAttributeValueDocument>,
    private helperService: HelperService,
    private utilityService: UtilityService,
  ) {}

  /**
   * Remove base64 encoded images from categories, products, and galleries.
   */
  async removeBase64() {
    const updateImageFields = async (model: Model<any>, fields: string[]) => {
      for (const field of fields) {
        await model.updateMany(
          { [field]: { $regex: '^data:image' } },
          { $unset: { [field]: '' } }
        ).exec();
      }
    };

    // Update image fields in all models.
    await updateImageFields(this.categoryModel, ['opengraph_image', 'image']);
    await updateImageFields(this.productModel, ['opengraph_image']);
    await updateImageFields(this.productGalleryModel, ['image']);

    return 'success';
  }

  /**
   * Fetch category and associated data by URL.
   * @param url The category URL to search.
   */
  async findOne(url: string) {
    try {
      const { getCategoryUrl, getParams, urlValues } = this.extractUrlParameters(url);

      // Fetch category based on the URL.
      const category = await this.getCategoryByUrl(getCategoryUrl);
      if (!category) throw new NotFoundException(ERROR_MESSAGES.NOT_FOUND('Category'));

      // Handle filters
      const filterValues = await this.filterValueModel.find({ url: { $in: urlValues } }).exec();
      const { filterValuesAttributes, filterValuesOptions, getNamesFromFilterValues } = this.processFilterValues(filterValues);

      let filters = await this.getCategoryFilters(category);

      // Query product attributes and options
      const productAttributes = await this.productAttributeValueModel.find({
        name_ua: { $in: getNamesFromFilterValues },
      }).populate({
        path: 'product',
        match: { deleted_at: null },
        populate: { path: 'options', match: { deleted_at: null } },
      }).exec();

      const { optionsByProductAttributes, productOptions } = await this.getProductOptions(filterValuesOptions, productAttributes);

      const { assignAttributesAndOptions, allOptionIds } = this.combineOptions(category, optionsByProductAttributes, productOptions);

      const finalOptions = await this.queryFinalOptions(assignAttributesAndOptions, allOptionIds);

      // Handle breadcrumbs, tags, and options viewed with
      const breadcrumbs = await this.helperService.getParentTreeCategories(category._id);
      const tags = await this.helperService.getTagsForCategory(category);
      const optionsViewedWith = await this.getOptionsViewedWith(category);

      return {
        status: true,
        data: { category, options: finalOptions, filters, tags, breadcrumbs, optionsViewedWith }
      };
    } catch (error) {
      throw new HttpException({ message: error.message }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Extract and process URL parameters for category filtering.
   */
  private extractUrlParameters(url: string) {
    const parts = url.split('__');
    const getCategoryUrl = parts[0];
    const params = parts.slice(1).map(param => param.split('_'));

    const getParams: any = params.reduce((acc, [key, value]) => {
      acc[key] = acc[key] || [];
      acc[key].push(isNaN(Number(value)) ? value : value.toString());
      return acc;
    }, {});

    const urlValues = Object.values(getParams).flat();
    return { getCategoryUrl, getParams, urlValues };
  }

  /**
   * Fetch category by URL from the database.
   */
  private async getCategoryByUrl(url: string) {
    return this.categoryModel
      .findOne({ url, deleted_at: null })
      .populate({
        path: 'products',
        match: { deleted_at: null },
        populate: { path: 'options', match: { deleted_at: null }, select: '_id' },
      })
      .populate({
        path: 'categories_viewed_with',
        populate: [
          { path: 'products', match: { deleted_at: null }, populate: { path: 'options', match: { deleted_at: null } } },
          { path: 'child_products', match: { deleted_at: null }, populate: { path: 'options', match: { deleted_at: null } } }
        ],
      })
      .exec();
  }

  /**
   * Process filter values and separate attributes and options.
   */
  private processFilterValues(filterValues: FilterValue[]) {
    const filterValuesAttributes:string[] = [];
    const filterValuesOptions:string[] = [];
    const getNamesFromFilterValues = filterValues.map((item) => item.name_ua);

    filterValues.forEach(filterValue => {
      if (filterValue.attribute_value) filterValuesAttributes.push(filterValue.attribute_value);
      if (filterValue.option_value) filterValuesOptions.push(filterValue.option_value);
    });

    return { filterValuesAttributes, filterValuesOptions, getNamesFromFilterValues };
  }

  /**
   * Fetch category filters based on active filters.
   */
  private async getCategoryFilters(category: CategoryDocument) {
    return this.filterModel.find({ categories: category._id, status: true })
      .populate({ path: 'filter_values', match: { status: true } })
      .exec();
  }

  /**
   * Get product options based on attributes and filter values.
   */
  private async getProductOptions(filterValuesOptions: any[], productAttributes: any[]) {
    const optionsByProductAttributes = productAttributes.flatMap(product =>
      product.product && product.product.options ? product.product.options : []
    );

    const productOptions = await this.productOptionModel
      .find({ _id: { $in: filterValuesOptions } })
      .exec();

    return { optionsByProductAttributes, productOptions };
  }

  /**
   * Combine options from different sources (attributes, filter options, etc.).
   */
  private combineOptions(category: CategoryDocument, optionsByProductAttributes: any[], productOptions: any[]) {
    const assignAttributesAndOptions = optionsByProductAttributes.concat(productOptions);

    const optionAllChildProductsIds = category.child_products.reduce(
      (acc: any[], product: any) => acc.concat(product.options.map((option) => option._id)), []
    );
    const optionAllProductsIds = category.products.reduce(
      (acc: any[], product: any) => acc.concat(product.options.map((option) => option._id)), []
    );

    const allOptionIds = [...optionAllChildProductsIds, ...optionAllProductsIds];
    return { assignAttributesAndOptions, allOptionIds };
  }

  /**
   * Query final options after applying filters.
   */
  private async queryFinalOptions(assignAttributesAndOptions: any[], allOptionIds: any[]) {
    const uniqueOptionIds = assignAttributesAndOptions.map(option => option._id.toString());

    const queryOption = uniqueOptionIds.length > 0
      ? this.productOptionModel.find({ _id: { $in: uniqueOptionIds } })
      : this.productOptionModel.find({ _id: { $in: allOptionIds } });

    queryOption.where('deleted_at').equals(null);

    return queryOption.populate({
      path: 'product',
      populate: [
        { path: 'attributes' },
        { path: 'attribute_values' },
        { path: 'gallery', match: { deleted_at: null } },
        { path: 'main_category', match: { deleted_at: null } },
        { path: 'categories', match: { deleted_at: null } }
      ]
    }).exec();
  }

  /**
   * Fetch options for categories viewed with the current one.
   */
  private async getOptionsViewedWith(category: CategoryDocument) {
    const optionsForViewedWithArray:string[] = [];

    if (category && category.categories_viewed_with) {
      category.categories_viewed_with.forEach(viewedCategory => {
        viewedCategory.child_products?.forEach(product => {
          product.options?.forEach((option :any) => optionsForViewedWithArray.push(option));
        });
        viewedCategory.products?.forEach(product => {
          product.options?.forEach((option :any) => optionsForViewedWithArray.push(option));
        });
      });
    }

    const optionsForViewedWithIds = optionsForViewedWithArray.map((item :any) => item._id) ?? [];
    const unsortedOptionsForViewedWith = await this.productOptionModel.find({ _id: { $in: optionsForViewedWithIds } })
      .populate({
        path: 'product',
        populate: [
          { path: 'options' },
          { path: 'gallery' }
        ]
      })
      .exec();

    return this.utilityService.sortingOptionsByType(unsortedOptionsForViewedWith);
  }
}
