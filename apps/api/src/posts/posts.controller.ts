import { Body, Controller, DefaultValuePipe, Get, Headers, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  CreatePostRequest,
  createPostSchema,
  PostListResponse,
  PostView,
  ResolvePublicationRequest,
  resolvePublicationSchema,
} from '@sp/contracts';
import type { Response } from 'express';
import { AuthUser, CurrentUser, ReqContext, RequestMeta } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PostsService } from './posts.service';

@Controller()
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post('posts')
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createPostSchema)) body: CreatePostRequest,
    @ReqContext() meta: RequestMeta,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PostView> {
    const { created, post } = await this.posts.create(user.id, idempotencyKey, body, meta);
    res.status(created ? 201 : 200);
    return post;
  }

  @Get('posts')
  list(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<PostListResponse> {
    return this.posts.list(user.id, cursor, limit);
  }

  @Get('posts/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PostView> {
    return this.posts.get(user.id, id);
  }

  @Post('posts/:id/cancel')
  @HttpCode(200)
  cancelPost(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() meta: RequestMeta): Promise<PostView> {
    return this.posts.cancelPost(user.id, id, meta);
  }

  @Post('publications/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() meta: RequestMeta): Promise<PostView> {
    return this.posts.retry(user.id, id, meta);
  }

  @Post('publications/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() meta: RequestMeta): Promise<PostView> {
    return this.posts.cancel(user.id, id, meta);
  }

  @Post('publications/:id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resolvePublicationSchema)) body: ResolvePublicationRequest,
    @ReqContext() meta: RequestMeta,
  ): Promise<PostView> {
    return this.posts.resolve(user.id, id, body, meta);
  }
}
