import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import { ConnectionView, SetDestinationsRequest, setDestinationsSchema, SocialAccountView, StartConnectionResponse } from '@sp/contracts';
import type { Response } from 'express';
import { AppConfig } from '../config/app-config';
import { RateLimit } from '../common/rate-limit.guard';
import { AuthUser, CurrentUser, Public, ReqContext, RequestMeta } from '../common/request-context';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ConnectionsService } from './connections.service';

@Controller()
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('connections/:provider/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('provider') provider: string): Promise<StartConnectionResponse> {
    return this.connections.start(user.id, provider);
  }

  @Public()
  @RateLimit({ bucket: 'oauth-callback', limit: 30, windowMs: 60_000 })
  @Get('connections/:provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: { code?: string; state?: string; error?: string },
    @ReqContext() meta: RequestMeta,
    @Res() res: Response,
  ): Promise<void> {
    const deepLink = await this.connections.callback(provider, query, meta);
    // A tiny page instead of a bare 302 so desktop browsers during testing still show something useful.
    res
      .status(302)
      .setHeader('Location', deepLink)
      .type('html')
      .send(`<!doctype html><meta name="viewport" content="width=device-width"><p style="font-family:sans-serif">Returning to the app… <a href="${deepLink}">Continue</a></p>`);
  }

  @Get('connections')
  list(@CurrentUser() user: AuthUser): Promise<ConnectionView[]> {
    return this.connections.list(user.id);
  }

  @Put('connections/:id/destinations')
  setDestinations(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setDestinationsSchema)) body: SetDestinationsRequest,
    @ReqContext() meta: RequestMeta,
  ): Promise<ConnectionView[]> {
    return this.connections.setDestinations(user.id, id, body.activeSocialAccountIds, meta);
  }

  @Post('connections/:id/validate')
  @HttpCode(200)
  validate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConnectionView[]> {
    return this.connections.validateConnection(user.id, id);
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqContext() meta: RequestMeta): Promise<void> {
    await this.connections.disconnect(user.id, id, meta);
  }

  @Get('social-accounts')
  accounts(@CurrentUser() user: AuthUser): Promise<SocialAccountView[]> {
    return this.connections.listAccounts(user.id);
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const page = (title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,Roboto,sans-serif;background:#F0FDFA;color:#134E4A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
  .card{background:#fff;border-radius:16px;padding:28px;max-width:420px;width:100%;box-shadow:0 4px 6px rgba(0,0,0,.08)}
  h1{font-size:22px;margin:0 0 8px} p{line-height:1.5;color:#475569} .tag{display:inline-block;background:#FEF3C7;color:#92400E;border-radius:999px;padding:4px 10px;font-size:13px;font-weight:600;margin-bottom:16px}
  a.btn{display:block;text-align:center;padding:14px;border-radius:10px;font-weight:600;text-decoration:none;margin-top:12px;font-size:16px}
  .primary{background:#0F766E;color:#fff} .secondary{border:2px solid #CBD5E1;color:#334155}
</style></head><body><main class="card">${body}</main></body></html>`;

/** Local-only pages that stand in for Google/Meta while PROVIDER_MODE=fake. */
@Controller('dev')
export class DevController {
  constructor(private readonly config: AppConfig) {}

  @Public()
  @Get('oauth/:provider')
  consent(@Param('provider') provider: string, @Query('state') state: string, @Query('redirect_uri') redirectUri: string, @Res() res: Response): void {
    if (!this.config.isFakeProviders) throw new NotFoundException();
    const name = provider === 'google' ? 'Google (YouTube)' : 'Meta (Instagram & Facebook)';
    const allow = `${redirectUri}?${new URLSearchParams({ code: 'fake-approved', state })}`;
    const deny = `${redirectUri}?${new URLSearchParams({ error: 'access_denied', state })}`;
    res.type('html').send(
      page(
        `Connect ${name}`,
        `<span class="tag">Simulated login</span><h1>Connect ${escapeHtml(name)}</h1>
         <p>This is a local test sign-in. No real account is used. Social Publisher will be able to publish videos and read analytics for the demo account.</p>
         <a class="btn primary" href="${escapeHtml(allow)}">Allow</a><a class="btn secondary" href="${escapeHtml(deny)}">Cancel</a>`,
      ),
    );
  }

  @Public()
  @Get('fake-posts/:platform/:externalId')
  fakePost(@Param('platform') platform: string, @Param('externalId') externalId: string, @Res() res: Response): void {
    if (!this.config.isFakeProviders) throw new NotFoundException();
    res.type('html').send(
      page('Simulated post', `<span class="tag">Simulated ${escapeHtml(platform)} post</span><h1>Published</h1><p>In live mode this link opens the real post on ${escapeHtml(platform)}.</p><p><code>${escapeHtml(externalId)}</code></p>`),
    );
  }
}
