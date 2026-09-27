import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  CompleteUploadRequest,
  completeUploadSchema,
  MediaResponse,
  StartUploadRequest,
  startUploadSchema,
  StartUploadResponse,
  uploadPartsQuerySchema,
} from '@sp/contracts';
import { AuthUser, CurrentUser } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  startUpload(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(startUploadSchema)) body: StartUploadRequest): Promise<StartUploadResponse> {
    return this.media.startUpload(user.id, body);
  }

  @Get(':id/upload-parts')
  uploadParts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(uploadPartsQuerySchema)) query: { parts: number[] },
  ) {
    return this.media.presignParts(user.id, id, query.parts);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(completeUploadSchema)) body: CompleteUploadRequest,
  ): Promise<MediaResponse> {
    return this.media.complete(user.id, id, body.parts);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<MediaResponse> {
    return this.media.get(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.media.remove(user.id, id);
  }
}
