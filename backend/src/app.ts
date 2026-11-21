import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { config } from './config/env';
import routes from './routes';
import { apiLimiter } from './shared/middleware/rateLimit.middleware';
import { originGuard } from './shared/middleware/originGuard.middleware';
import { notFoundHandler } from './shared/middleware/notFound.middleware';
import { errorHandler } from './shared/errors/errorHandler';

// Local dev servers are only trusted when we are not in production.
const allowedOrigins = [config.frontendUrl, ...(config.isProduction ? [] : ['http://localhost:5173', 'http://localhost:3000'])];

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());
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

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
