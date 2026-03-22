import nodemailer from 'nodemailer';
import type { AppEnv } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('auth-email');

type SignupAuthenticationEmailInput = {
  email: string;
  username: string;
};

type AuthEmailService = {
  sendSignupAuthenticationEmail(input: SignupAuthenticationEmailInput): Promise<boolean>;
};

export function createAuthEmailService(env: AppEnv): AuthEmailService {
  if (!env.AUTH_EMAIL_ENABLED) {
    return {
      async sendSignupAuthenticationEmail() {
        return false;
      },
    };
  }

  const from = env.AUTH_EMAIL_FROM;
  const host = env.AUTH_EMAIL_SMTP_HOST;
  const port = env.AUTH_EMAIL_SMTP_PORT;

  if (!from || !host || !port) {
    logger.warn('auth_email_disabled_missing_smtp_configuration');
    return {
      async sendSignupAuthenticationEmail() {
        return false;
      },
    };
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: env.AUTH_EMAIL_SMTP_SECURE,
    ...(env.AUTH_EMAIL_SMTP_USER && env.AUTH_EMAIL_SMTP_PASS
      ? {
          auth: {
            user: env.AUTH_EMAIL_SMTP_USER,
            pass: env.AUTH_EMAIL_SMTP_PASS,
          },
        }
      : {}),
  });

  return {
    async sendSignupAuthenticationEmail(input: SignupAuthenticationEmailInput) {
      const verifyUrl = new URL(env.AUTH_EMAIL_VERIFY_BASE_URL);
      verifyUrl.searchParams.set('email', input.email);

      await transporter.sendMail({
        from,
        to: input.email,
        subject: 'Trading Cockpit authentication email',
        text: `Hi ${input.username},\n\nYour Trading Cockpit account was created successfully.\nUse this link to verify your email: ${verifyUrl.toString()}\n\nIf you did not create this account, ignore this message.`,
        html: `<p>Hi ${input.username},</p><p>Your Trading Cockpit account was created successfully.</p><p>Use this link to verify your email:</p><p><a href="${verifyUrl.toString()}">${verifyUrl.toString()}</a></p><p>If you did not create this account, ignore this message.</p>`,
      });

      return true;
    },
  };
}
