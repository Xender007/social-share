import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/request-context';

/**
 * Public, unauthenticated legal/info pages required by Meta app review (Facebook/Instagram):
 * a Privacy Policy URL and a Data Deletion Instructions URL, plus a minimal app-website landing
 * page. Mounted outside the `v1` prefix in main.ts, the same way health.controller.ts is —
 * these are plain browser pages, not API responses.
 */
const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F8FAFC;color:#0F172A;line-height:1.6}
  main{max-width:680px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:26px;margin:0 0 4px}
  h2{font-size:18px;margin:28px 0 8px;color:#0F172A}
  p{margin:0 0 12px;color:#334155}
  ul{margin:0 0 12px;padding-left:20px;color:#334155}
  li{margin-bottom:6px}
  .updated{color:#64748B;font-size:14px;margin-bottom:24px}
  a{color:#0F766E}
  code{background:#E2E8F0;border-radius:4px;padding:1px 6px;font-size:14px}
  .home-link{display:inline-block;margin-bottom:20px;font-size:14px;text-decoration:none;color:#0F766E}
</style>
</head>
<body><main>${body}</main></body>
</html>`;

@Controller()
export class LegalController {
  @Public()
  @Get('/')
  home(@Res() res: Response): void {
    res.type('html').send(
      page(
        'Social Publisher',
        `<h1>Social Publisher</h1>
         <p>A personal app that publishes videos to the owner's own YouTube, Instagram and Facebook accounts.</p>
         <p><a href="/privacy">Privacy Policy</a> &middot; <a href="/data-deletion">Data Deletion Instructions</a></p>`,
      ),
    );
  }

  @Public()
  @Get('privacy')
  privacy(@Res() res: Response): void {
    res.type('html').send(
      page(
        'Privacy Policy — Social Publisher',
        `<a class="home-link" href="/">&larr; Social Publisher</a>
         <h1>Privacy Policy</h1>
         <p class="updated">Last updated: September 28, 2026</p>

         <p>Social Publisher is a personal-use app, built and operated by a single individual, that publishes
         the owner's own videos to the owner's own YouTube, Instagram and Facebook accounts. This page explains
         what the app stores and why.</p>

         <h2>What we store</h2>
         <ul>
           <li><strong>Account info:</strong> your email address and display name.</li>
           <li><strong>Connected platform tokens:</strong> OAuth access and refresh tokens for the YouTube,
           Facebook and Instagram accounts you connect, so the app can publish and read analytics on your
           behalf. Tokens are encrypted at rest (AES-256-GCM) before they are stored.</li>
           <li><strong>Uploaded videos:</strong> stored temporarily to publish your posts. A video is deleted
           automatically once every platform it was published to has reached a final state (published,
           permanently failed, or cancelled), and in any case within a few days of no longer being needed.</li>
           <li><strong>Captions and post details</strong> you write for each post.</li>
           <li><strong>Post and publication status</strong> (queued, publishing, published, failed, etc.) for
           each platform.</li>
           <li><strong>Analytics numbers</strong> (views, likes, comments, etc.) pulled from YouTube, Facebook
           and Instagram for posts published through the app.</li>
           <li><strong>An audit log</strong> of account and publishing actions, for troubleshooting.</li>
         </ul>

         <h2>What we don't do</h2>
         <p>We do not sell or share your data with third parties. Data is only sent to YouTube or Meta
         (Facebook/Instagram) to publish a post or read its analytics, at your request.</p>

         <h2>Deleting your data</h2>
         <p>Disconnecting a connected account inside the app immediately removes that account's stored access
         and refresh tokens. To delete all of your data (account, media, captions, analytics and audit
         history), email <a href="mailto:suprotim6@gmail.com">suprotim6@gmail.com</a> and it will be deleted.</p>

         <h2>Contact</h2>
         <p>Questions about this policy: <a href="mailto:suprotim6@gmail.com">suprotim6@gmail.com</a>.</p>`,
      ),
    );
  }

  @Public()
  @Get('data-deletion')
  dataDeletion(@Res() res: Response): void {
    res.type('html').send(
      page(
        'Data Deletion Instructions — Social Publisher',
        `<a class="home-link" href="/">&larr; Social Publisher</a>
         <h1>Data Deletion Instructions</h1>
         <p class="updated">Last updated: September 28, 2026</p>

         <p>Social Publisher is a personal-use app operated by a single individual. Here is how to remove
         your data.</p>

         <h2>Disconnect a single platform account</h2>
         <p>In the app, go to <strong>Connections</strong> and disconnect the YouTube, Facebook or Instagram
         account you want removed. This immediately deletes that account's stored access and refresh tokens
         from our database. The platform account itself is unaffected — this only removes Social Publisher's
         access to it.</p>

         <h2>Delete everything</h2>
         <p>To delete your account and all associated data — profile, connected-account tokens, uploaded
         videos, captions, post/publication history, analytics numbers and audit log — email
         <a href="mailto:suprotim6@gmail.com">suprotim6@gmail.com</a> from the email address registered with
         the app, asking for your data to be deleted. This is done manually, as the app currently has a single
         owner/operator; expect a reply within a few days.</p>

         <h2>Automatic deletion</h2>
         <p>Uploaded videos are removed automatically without any request needed: once a post reaches a final
         state on every platform it targeted (published, permanently failed, or cancelled), its video is
         deleted from storage, and otherwise within a few days regardless.</p>

         <h2>Contact</h2>
         <p><a href="mailto:suprotim6@gmail.com">suprotim6@gmail.com</a></p>`,
      ),
    );
  }
}
