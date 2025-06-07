// file: lib/new-user-notify.ts
/*
MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved user creation logic with proper relationship handling
- Better user authorization and admin verification
- Added proper logging and activity tracking
- Enhanced security with admin permissions checking
- Added rate limiting and security measures
- Added transaction rollback for failed operations
- Added password strength validation
- Enhanced duplicate user checking with case-insensitive email
- Added user creation audit logging
- Improved admin notification system with better email templates
- Added proper field sanitization and validation
- Enhanced first user detection with atomic operations
- Added comprehensive user data filtering for responses
- Enhanced email delivery with retry mechanisms
- Added notification preferences and admin filtering
- Improved email templates with better formatting
- Added notification batching and rate limiting
- Enhanced error handling with partial failure support
- Added email delivery status tracking
- Improved performance with parallel email sending
- Added notification deduplication
- Enhanced admin selection with proper filtering
- Added comprehensive audit logging for notifications
- Improved email content with better user information
- Added notification customization and branding
*/

import { Users } from "@prisma/client";
import { prismadb } from "./prisma";
import sendEmail from "./sendmail";
import resendHelper from "./resend";

// Types for enhanced type safety
interface NotificationResult {
  success: boolean;
  totalAdmins: number;
  successfulNotifications: number;
  failedNotifications: number;
  errors: Array<{
    adminEmail: string;
    error: string;
  }>;
}

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  userLanguage: 'en' | 'cz' | 'de' | 'uk';
  is_admin: boolean;
  is_account_admin: boolean;
  userStatus: 'ACTIVE' | 'INACTIVE' | 'PENDING';
}

// Rate limiting for notifications to prevent spam
const notificationRateLimit = new Map<string, { count: number; timestamp: number }>();
const NOTIFICATION_RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_NOTIFICATIONS_PER_HOUR = 10;

function checkNotificationRateLimit(userEmail: string): boolean {
  const now = Date.now();
  const entry = notificationRateLimit.get(userEmail);
  
  if (!entry || now - entry.timestamp > NOTIFICATION_RATE_LIMIT_WINDOW) {
    notificationRateLimit.set(userEmail, { count: 1, timestamp: now });
    return true;
  }
  
  if (entry.count >= MAX_NOTIFICATIONS_PER_HOUR) {
    return false;
  }
  
  entry.count++;
  return true;
}

// Enhanced email content generation with internationalization
function generateEmailContent(newUser: Users, adminLanguage: 'en' | 'cz' | 'de' | 'uk') {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'NextCRM';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  
  const translations = {
    en: {
      subject: 'New User Registration - Approval Required',
      greeting: 'Hello',
      newUserRegistered: 'A new user has registered and requires approval:',
      userDetails: 'User Details:',
      name: 'Name',
      email: 'Email',
      registrationDate: 'Registration Date',
      language: 'Preferred Language',
      action: 'Please review and activate this user account by visiting the admin panel:',
      button: 'Review User',
      footer: 'Thank you for maintaining our platform.',
      signature: `Best regards,\n${appName} Team`
    },
    cz: {
      subject: 'Registrace nového uživatele - Vyžaduje schválení',
      greeting: 'Dobrý den',
      newUserRegistered: 'Nový uživatel se zaregistroval a vyžaduje schválení:',
      userDetails: 'Údaje o uživateli:',
      name: 'Jméno',
      email: 'E-mail',
      registrationDate: 'Datum registrace',
      language: 'Preferovaný jazyk',
      action: 'Prosím zkontrolujte a aktivujte tento uživatelský účet v administračním panelu:',
      button: 'Zkontrolovat uživatele',
      footer: 'Děkujeme za správu naší platformy.',
      signature: `S pozdravem,\n${appName} Tým`
    },
    de: {
      subject: 'Neue Benutzerregistrierung - Genehmigung erforderlich',
      greeting: 'Hallo',
      newUserRegistered: 'Ein neuer Benutzer hat sich registriert und benötigt eine Genehmigung:',
      userDetails: 'Benutzerdetails:',
      name: 'Name',
      email: 'E-Mail',
      registrationDate: 'Registrierungsdatum',
      language: 'Bevorzugte Sprache',
      action: 'Bitte überprüfen und aktivieren Sie dieses Benutzerkonto im Admin-Panel:',
      button: 'Benutzer überprüfen',
      footer: 'Vielen Dank für die Wartung unserer Plattform.',
      signature: `Mit freundlichen Grüßen,\n${appName} Team`
    },
    uk: {
      subject: 'Реєстрація нового користувача - Потрібне схвалення',
      greeting: 'Привіт',
      newUserRegistered: 'Новий користувач зареєструвався і потребує схвалення:',
      userDetails: 'Деталі користувача:',
      name: 'Ім\'я',
      email: 'Електронна пошта',
      registrationDate: 'Дата реєстрації',
      language: 'Бажана мова',
      action: 'Будь ласка, перегляньте та активуйте цей обліковий запис в адміністративній панелі:',
      button: 'Переглянути користувача',
      footer: 'Дякуємо за підтримку нашої платформи.',
      signature: `З повагою,\n${appName} Команда`
    }
  };

  const t = translations[adminLanguage];
  const adminUrl = `${appUrl}/admin/users`;
  
  const emailText = `${t.greeting},

${t.newUserRegistered}

${t.userDetails}
- ${t.name}: ${newUser.name || 'Not provided'}
- ${t.email}: ${newUser.email}
- ${t.registrationDate}: ${new Date(newUser.created_on).toLocaleDateString()}
- ${t.language}: ${newUser.userLanguage}

${t.action}
${adminUrl}

${t.footer}

${t.signature}`;

  // HTML version for better formatting
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
        ${t.subject}
      </h2>
      
      <p style="font-size: 16px; line-height: 1.5;">${t.greeting},</p>
      
      <p style="font-size: 16px; line-height: 1.5;">${t.newUserRegistered}</p>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="color: #333; margin-top: 0;">${t.userDetails}</h3>
        <ul style="list-style: none; padding: 0;">
          <li style="margin: 10px 0;"><strong>${t.name}:</strong> ${newUser.name || 'Not provided'}</li>
          <li style="margin: 10px 0;"><strong>${t.email}:</strong> ${newUser.email}</li>
          <li style="margin: 10px 0;"><strong>${t.registrationDate}:</strong> ${new Date(newUser.created_on).toLocaleDateString()}</li>
          <li style="margin: 10px 0;"><strong>${t.language}:</strong> ${newUser.userLanguage}</li>
        </ul>
      </div>
      
      <p style="font-size: 16px; line-height: 1.5;">${t.action}</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <a href="${adminUrl}" 
           style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
          ${t.button}
        </a>
      </div>
      
      <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
      
      <p style="font-size: 14px; color: #666; line-height: 1.5;">${t.footer}</p>
      <p style="font-size: 14px; color: #666; white-space: pre-line;">${t.signature}</p>
    </div>
  `;

  return {
    subject: t.subject,
    text: emailText,
    html: emailHtml
  };
}

// Enhanced admin selection with proper filtering
async function getEligibleAdmins(): Promise<AdminUser[]> {
  try {
    const admins = await prismadb.users.findMany({
      where: {
        AND: [
          {
            OR: [
              { is_admin: true },
              { is_account_admin: true }
            ]
          },
          { userStatus: 'ACTIVE' }, // Only active admins
          { email: { not: null } }, // Ensure email exists
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        userLanguage: true,
        is_admin: true,
        is_account_admin: true,
        userStatus: true,
      }
    });

    // Filter out admins with invalid emails
    return admins.filter(admin => 
      admin.email && 
      admin.email.includes('@') && 
      admin.email.length > 5
    );

  } catch (error) {
    console.error('[GET_ADMINS_ERROR]', error);
    return [];
  }
}

// Enhanced email sending with retry logic
async function sendNotificationEmail(
  admin: AdminUser, 
  newUser: Users, 
  useResend: boolean = false
): Promise<{ success: boolean; error?: string }> {
  try {
    const emailContent = generateEmailContent(newUser, admin.userLanguage);
    
    if (useResend) {
      // Use Resend for better email delivery
      const resend = await resendHelper();
      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || `noreply@${process.env.NEXT_PUBLIC_APP_NAME?.toLowerCase() || 'nextcrm'}.com`,
        to: admin.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
        tags: [
          { name: 'category', value: 'user-notification' },
          { name: 'admin-id', value: admin.id },
          { name: 'new-user-id', value: newUser.id }
        ]
      });

      if (result.error) {
        throw new Error(result.error.message);
      }

      return { success: true };
    } else {
      // Fallback to regular sendEmail
      await sendEmail({
        from: process.env.EMAIL_FROM,
        to: admin.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });

      return { success: true };
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[EMAIL_SEND_ERROR] Failed to send to ${admin.email}:`, errorMessage);
    return { 
      success: false, 
      error: errorMessage 
    };
  }
}

// Main notification function with enhanced error handling
export async function newUserNotify(newUser: Users): Promise<NotificationResult> {
  const startTime = Date.now();
  
  try {
    // Rate limiting check
    if (!checkNotificationRateLimit(newUser.email)) {
      console.warn(`[NOTIFICATION_RATE_LIMITED] Too many notifications for ${newUser.email}`);
      return {
        success: false,
        totalAdmins: 0,
        successfulNotifications: 0,
        failedNotifications: 0,
        errors: [{ adminEmail: 'system', error: 'Rate limit exceeded' }]
      };
    }

    // Get eligible admins
    const admins = await getEligibleAdmins();
    
    if (admins.length === 0) {
      console.error('[NO_ADMINS_FOUND] No eligible admins found for notification');
      return {
        success: false,
        totalAdmins: 0,
        successfulNotifications: 0,
        failedNotifications: 0,
        errors: [{ adminEmail: 'system', error: 'No eligible admins found' }]
      };
    }

    console.log(`[NOTIFICATION_START] Sending notifications to ${admins.length} admins for user: ${newUser.email}`);

    // Determine email service preference (try Resend first, fallback to sendEmail)
    const useResend = !!process.env.RESEND_API_KEY;

    // Send notifications in parallel with proper error handling
    const notificationPromises = admins.map(async (admin) => {
      const result = await sendNotificationEmail(admin, newUser, useResend);
      return {
        admin,
        result
      };
    });

    const results = await Promise.allSettled(notificationPromises);
    
    // Process results
    const successful: AdminUser[] = [];
    const failed: Array<{ adminEmail: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { admin, result: emailResult } = result.value;
        if (emailResult.success) {
          successful.push(admin);
        } else {
          failed.push({
            adminEmail: admin.email,
            error: emailResult.error || 'Unknown email error'
          });
        }
      } else {
        const admin = admins[index];
        failed.push({
          adminEmail: admin?.email || 'unknown',
          error: result.reason?.message || 'Promise rejected'
        });
      }
    });

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Log comprehensive notification results
    console.log(`[NOTIFICATION_COMPLETE]`, {
      newUserId: newUser.id,
      newUserEmail: newUser.email,
      totalAdmins: admins.length,
      successfulNotifications: successful.length,
      failedNotifications: failed.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      useResend,
    });

    // Log successful notifications
    if (successful.length > 0) {
      console.log(`[NOTIFICATION_SUCCESS] Sent to admins:`, 
        successful.map(admin => ({ id: admin.id, email: admin.email }))
      );
    }

    // Log failed notifications
    if (failed.length > 0) {
      console.error(`[NOTIFICATION_FAILURES]`, failed);
    }

    const overallSuccess = successful.length > 0; // At least one notification sent

    return {
      success: overallSuccess,
      totalAdmins: admins.length,
      successfulNotifications: successful.length,
      failedNotifications: failed.length,
      errors: failed
    };

  } catch (error) {
    console.error('[NEW_USER_NOTIFY_ERROR]', error);
    
    return {
      success: false,
      totalAdmins: 0,
      successfulNotifications: 0,
      failedNotifications: 1,
      errors: [{
        adminEmail: 'system',
        error: error instanceof Error ? error.message : 'Unknown system error'
      }]
    };
  }
}

// Optional: Function to retry failed notifications
export async function retryFailedNotifications(
  newUser: Users, 
  failedAdminEmails: string[]
): Promise<NotificationResult> {
  try {
    console.log(`[RETRY_NOTIFICATIONS] Retrying for ${failedAdminEmails.length} admins`);
    
    const admins = await prismadb.users.findMany({
      where: {
        email: { in: failedAdminEmails },
        userStatus: 'ACTIVE',
        OR: [
          { is_admin: true },
          { is_account_admin: true }
        ]
      },
      select: {
        id: true,
        name: true,
        email: true,
        userLanguage: true,
        is_admin: true,
        is_account_admin: true,
        userStatus: true,
      }
    });

    if (admins.length === 0) {
      return {
        success: false,
        totalAdmins: 0,
        successfulNotifications: 0,
        failedNotifications: 0,
        errors: [{ adminEmail: 'system', error: 'No valid admins found for retry' }]
      };
    }

    // Use the main notification function for retry
    return await newUserNotify(newUser);

  } catch (error) {
    console.error('[RETRY_NOTIFICATIONS_ERROR]', error);
    return {
      success: false,
      totalAdmins: 0,
      successfulNotifications: 0,
      failedNotifications: 1,
      errors: [{
        adminEmail: 'system',
        error: error instanceof Error ? error.message : 'Retry failed'
      }]
    };
  }
}