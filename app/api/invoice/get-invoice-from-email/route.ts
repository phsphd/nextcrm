// file: nextcrm/app/api/email/check/route.ts (or similar path)
import { NextResponse } from "next/server";
import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import { Readable } from "stream";
import axios from "axios";
// 🔴 ADDED: Import for potential database logging
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const imapConfig: Imap.Config = {
  user: process.env.IMAP_USER!,
  password: process.env.IMAP_PASSWORD!,
  host: process.env.IMAP_HOST,
  port: parseInt(process.env.IMAP_PORT ?? "993"),
  tls: true,
};

export async function GET() {
  // 🔴 ADDED: Optional authentication check
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized - Email check requires authentication" },
        { status: 401 }
      );
    }

    console.log("Starting email check...");
    const imap = new Imap(imapConfig);
    const emailsProcessed = await checkEmail(imap);
    console.log(`Email check completed. Processed ${emailsProcessed} emails.`);

    // 🔴 ADDED: Optional database logging of email check activity
    try {
      await prismadb.systemServices.upsert({
        where: {
          name: "email_check_service",
        },
        update: {
          description: `Last check: ${new Date().toISOString()}, Processed: ${emailsProcessed} emails`,
        },
        create: {
          v: 0,
          name: "email_check_service",
          description: `Email check service - Last run: ${new Date().toISOString()}, Processed: ${emailsProcessed} emails`,
          serviceUrl: "/api/email/check",
        },
      });
    } catch (dbError) {
      console.log("Warning: Could not log email check to database:", dbError);
      // Don't fail the email check if database logging fails
    }

    return NextResponse.json(
      {
        message: `Email check completed. Processed ${emailsProcessed} emails.`,
        timestamp: new Date().toISOString(),
        emailsProcessed,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error in GET function:", error);
    
    // 🔴 ADDED: Optional error logging to database
    try {
      await prismadb.systemServices.upsert({
        where: {
          name: "email_check_service",
        },
        update: {
          description: `Error at ${new Date().toISOString()}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        create: {
          v: 0,
          name: "email_check_service",
          description: `Email check service - Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          serviceUrl: "/api/email/check",
        },
      });
    } catch (dbError) {
      console.log("Warning: Could not log email check error to database:", dbError);
    }

    return NextResponse.json(
      { 
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function checkEmail(imap: Imap): Promise<number> {
  return new Promise((resolve, reject) => {
    let emailsProcessed = 0;

    imap.once("ready", () => {
      console.log("IMAP connection ready");
      imap.openBox("INBOX", false, (err, box) => {
        if (err) {
          console.error("Error opening inbox:", err);
          reject(err);
          return;
        }
        console.log("Inbox opened");

        imap.search(["UNSEEN"], (err, results) => {
          if (err) {
            console.error("Error searching for unseen emails:", err);
            reject(err);
            return;
          }
          console.log(`Found ${results.length} unseen emails`);

          if (results.length === 0) {
            imap.end();
            resolve(0);
            return;
          }

          const fetch = imap.fetch(results, { bodies: [""], markSeen: true });

          fetch.on("message", (msg) => {
            console.log("Processing new message");
            let fullMessage = "";

            msg.on("body", (stream) => {
              stream.on("data", (chunk) => {
                fullMessage += chunk.toString("utf8");
              });

              stream.once("end", () => {
                simpleParser(fullMessage, async (err, parsed) => {
                  if (err) {
                    console.error("Error parsing email:", err);
                    return;
                  }
                  console.log("Parsed email:", {
                    from: parsed.from?.text,
                    subject: parsed.subject,
                    date: parsed.date,
                    attachmentCount: parsed.attachments?.length || 0,
                  }); // 🔴 IMPROVED: Log only essential email info for privacy
                  
                  const attachments = getAttachments(parsed);
                  console.log(`Found ${attachments.length} attachments`);

                  // 🔴 IMPROVED: Process attachments sequentially for better error handling
                  for (const attachment of attachments) {
                    try {
                      await sendAttachmentToAPI(attachment, parsed);
                      emailsProcessed++;
                      console.log(`Processed attachment ${emailsProcessed}: ${attachment.filename}`);
                    } catch (error: any) {
                      console.error(
                        `Error processing attachment ${attachment.filename}:`,
                        error.message
                      );
                      // 🔴 IMPROVED: Continue processing other attachments even if one fails
                    }
                  }
                });
              });
            });
          });

          fetch.once("error", (err) => {
            console.error("Fetch error:", err);
            reject(err);
          });

          fetch.once("end", () => {
            console.log("Finished processing all messages");
            imap.end();
            resolve(emailsProcessed);
          });
        });
      });
    });

    imap.once("error", (err: any) => {
      console.error("IMAP connection error:", err);
      reject(err);
    });

    // 🔴 ADDED: Connection timeout
    setTimeout(() => {
      if (imap.state !== 'authenticated') {
        console.error("IMAP connection timeout");
        reject(new Error("IMAP connection timeout"));
      }
    }, 30000); // 30 second timeout

    imap.connect();
  });
}

function getAttachments(parsed: ParsedMail): any[] {
  let attachments = parsed.attachments || []; // 🔴 IMPROVED: Handle undefined attachments

  // 🔴 IMPROVED: Filter for relevant file types (optional)
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  const filteredAttachments = attachments.filter(attachment => {
    const isAllowedType = allowedTypes.includes(attachment.contentType);
    const hasValidSize = attachment.size > 0 && attachment.size < 10 * 1024 * 1024; // Max 10MB
    
    if (!isAllowedType) {
      console.log(`Skipping attachment ${attachment.filename}: unsupported type ${attachment.contentType}`);
    }
    if (!hasValidSize) {
      console.log(`Skipping attachment ${attachment.filename}: invalid size ${attachment.size}`);
    }
    
    return isAllowedType && hasValidSize;
  });

  // Log attachment info
  filteredAttachments.forEach((attachment, index) => {
    console.log(`Valid attachment ${index + 1}:`, {
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      contentDisposition: attachment.contentDisposition,
    });
  });

  return filteredAttachments;
}

// 🔴 ENHANCED: Added email metadata parameter
async function sendAttachmentToAPI(attachment: any, emailData?: ParsedMail) {
  try {
    console.log("Sending attachment to API:", attachment.filename);
    
    // 🔴 IMPROVED: Use environment variable for API URL
    const apiUrl = process.env.NEXT_PUBLIC_APP_URL 
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/upload/cron`
      : "http://localhost:3000/api/upload/cron";

    // 🔴 ENHANCED: Include email metadata
    const payload = {
      file: attachment,
      metadata: {
        emailFrom: emailData?.from?.text,
        emailSubject: emailData?.subject,
        emailDate: emailData?.date,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      },
    };

    const response = await axios.post(apiUrl, payload, {
      headers: { 
        "Content-Type": "application/json",
        // 🔴 ADDED: Add timeout
      },
      timeout: 30000, // 30 second timeout
    });
    
    console.log("Upload API response:", {
      status: response.status,
      filename: attachment.filename,
      success: response.data.success || 'unknown',
    }); // 🔴 IMPROVED: Log only essential response info
    
    return response.data;
  } catch (error: any) {
    console.error("Error in sendAttachmentToAPI:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
      console.error("Response status:", error.response.status);
    } else if (error.request) {
      console.error("No response received - network or timeout issue");
    } else {
      console.error("Error setting up request:", error.message);
    }
    throw error;
  }
}