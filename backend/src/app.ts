import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';

import { config } from './config/env';
import routes from './routes';
import { apiLimiter } from './shared/middleware/rateLimit.middleware';
import { originGuard } from './shared/middleware/originGuard.middleware';
import { notFoundHandler } from './shared/middleware/notFound.middleware';
import { errorHandler } from './shared/errors/errorHandler';

// Local dev servers are only trusted when we are not in production.
const allowedOrigins = [config.frontendUrl, ...(config.isProduction ? [] : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175', 'http://localhost:3000'])];

const app = express();

app.disable('x-powered-by');
// how many proxies stand in front of the backend (Render's own = 1; with the site on Vercel in front of Render = 2), so the real visitor address is used
app.set('trust proxy', Math.min(5, Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1)));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // pictures (video thumbnails, uploads) and video embeds from outside are allowed; scripts stay limited to this site
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'frame-src': ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
        'connect-src': ["'self'", ...(config.r2Origin ? [config.r2Origin] : [])]
      }
    }
  })
);
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// Links that carry a one-time secret (email verification, Google sign-in) must not end up in the access log.
morgan.token('safe-url', (req) =>
  String((req as express.Request).originalUrl)
    .replace(/(\/(?:verify-email|reset-password)\/)[^/?#]+/g, '$1[hidden]')
    .replace(/([?&](?:code|token|state)=)[^&]+/g, '$1[hidden]')
);
app.use(
  morgan(
    config.isProduction
      ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
      : ':method :safe-url :status :response-time ms - :res[content-length]'
  )
);

app.use('/api', originGuard(allowedOrigins), apiLimiter, routes);

// The built website, when it is next to the backend (the Docker image puts it in ./public): one address for the site and the API.
const siteDir = process.env.FRONTEND_DIST || path.join(__dirname, '..', 'public');
if (fs.existsSync(path.join(siteDir, 'index.html'))) {
  app.use(express.static(siteDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || /\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    res.sendFile(path.join(siteDir, 'index.html'));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
