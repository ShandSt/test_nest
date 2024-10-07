import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { CategoriesServiceV1 } from './categories.service';

@Controller({
  path: '',
  version: '1',
})
export class CategoriesControllerV1 {
  constructor(private categoriesService: CategoriesServiceV1) {}

  @Get(':url')
  @HttpCode(200)
  findOne(@Param('url') url: string) {
    return this.categoriesService.findOne(url);
  }

  @Post('/remove-base64')
  @HttpCode(200)
  removeBase64() {
    return this.categoriesService.removeBase64();
  }
}
