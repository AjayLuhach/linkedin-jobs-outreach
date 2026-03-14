/**
 * Email Sender Service
 * Handles sending emails via SMTP using nodemailer
 */

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { isValidEmail } from "./email-validator.js";

dotenv.config();

// ============================================================
// CONFIGURATION
// ============================================================

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && !value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const SMTP_HOST = getEnv("SMTP_HOST");
const SMTP_PORT = Number(getEnv("SMTP_PORT"));
const SMTP_SECURE = String(getEnv("SMTP_SECURE", false)).toLowerCase() === "true";
const SMTP_USER = getEnv("SMTP_USER");
const SMTP_PASS = getEnv("SMTP_PASS");
const FROM_NAME = process.env.FROM_NAME || "Job Applicant";

// Master resume path — resolved relative to project root
const RESUME_PATH = process.env.RESUME_PATH
  ? path.resolve(process.env.RESUME_PATH)
  : null;

// ============================================================
// TRANSPORTER
// ============================================================

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }
  return transporter;
}

/**
 * Verify SMTP connection
 * @returns {Promise<boolean>} True if connection is successful
 */
export async function verifyConnection() {
  try {
    await getTransporter().verify();
    console.log("   [OK] SMTP connection verified");
    return true;
  } catch (error) {
    console.error("   [FAIL] SMTP connection failed:", error.message);
    return false;
  }
}

// ============================================================
// EMAIL SENDING
// ============================================================

/**
 * Send a single email with optional resume attachment
 * @param {Object} emailData - Email object {to, subject, body}
 * @returns {Promise<Object>} Send result with success status
 */
export async function sendEmail(emailData) {
  const { to, subject, body } = emailData;

  // Validate required fields
  if (!to || !subject || !body) {
    const error = "Email must have to, subject, and body";
    console.error(`   [FAIL] ${to || '(no recipient)'}: ${error}`);
    return {
      success: false,
      error,
      to: to || null,
    };
  }

  // Validate email format
  if (!isValidEmail(to)) {
    const error = "Invalid email address format";
    console.error(`   [FAIL] ${to}: ${error}`);
    return {
      success: false,
      error,
      to,
    };
  }

  // Test mode: redirect emails to test inbox when EMAIL_TEST_MODE=true
  const testMode = process.env.EMAIL_TEST_MODE === 'true';
  const testInbox = process.env.EMAIL_TEST_INBOX || 'test@yopmail.com';
  const actualRecipient = testMode ? testInbox : to;

  if (testMode) {
    console.log(`   [TEST MODE] Redirecting ${to} -> ${actualRecipient}`);
  }

  // Prepare attachments (master resume — REQUIRED)
  if (!RESUME_PATH) {
    throw new Error("RESUME_PATH not set in .env — cannot send emails without resume attachment");
  }
  if (!fs.existsSync(RESUME_PATH)) {
    throw new Error(`Resume file not found at: ${RESUME_PATH} — cannot send emails without resume attachment`);
  }
  const attachments = [{
    filename: path.basename(RESUME_PATH),
    path: RESUME_PATH,
  }];

  try {
    const info = await getTransporter().sendMail({
      from: `"${FROM_NAME}" <${SMTP_USER}>`,
      to: actualRecipient,
      subject,
      text: body,
      attachments,
    });

    console.log(`   [SENT] ${actualRecipient} | messageId=${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      to: actualRecipient,
    };
  } catch (error) {
    console.error(`   [FAIL] ${actualRecipient}: ${error.message}`);
    return {
      success: false,
      error: error.message,
      to: actualRecipient,
    };
  }
}

export default {
  sendEmail,
  verifyConnection,
};
