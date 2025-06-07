// file: nextcrm/app/api/crm/leads/create-lead-from-web/route.ts
import { prismadb } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  if (req.headers.get("content-type") !== "application/json") {
    return NextResponse.json(
      { message: "Invalid content-type" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const headers = req.headers;

  if (!body) {
    return NextResponse.json({ message: "No body" }, { status: 400 });
  }
  if (!headers) {
    return NextResponse.json({ message: "No headers" }, { status: 400 });
  }

  const { 
    firstName, 
    lastName, 
    account, 
    job, 
    email, 
    phone, 
    lead_source,
    // 🔴 ADDED: Optional fields for better lead management
    description,
    refered_by,
    campaign,
    assigned_to,
    documentIds = [], // Array of document IDs to link
    source = "web_form" // Default source tracking
  } = body;

  //Validate auth with token from .env.local
  const token = headers.get("authorization");

  if (!token) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.NEXTCRM_TOKEN) {
    return NextResponse.json(
      { message: "NEXTCRM_TOKEN not defined in .env.local file" },
      { status: 401 }
    );
  }

  if (token.trim() !== process.env.NEXTCRM_TOKEN.trim()) {
    console.log("Unauthorized");
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  } else {
    if (!lastName) {
      return NextResponse.json(
        { message: "Missing required fields" },
        { status: 400 }
      );
    }
    
    try {
      // 🔴 MODIFIED: Use transaction to handle potential account linking and document relationships
      const newLead = await prismadb.$transaction(async (tx) => {
        // 🔴 ADDED: Try to find or create account if company name is provided
        let linkedAccountId = null;
        
        if (account) {
          // Try to find existing account by company name
          const existingAccount = await tx.crm_Accounts.findFirst({
            where: {
              name: {
                equals: account,
                mode: 'insensitive', // Case-insensitive search
              },
            },
          });

          if (existingAccount) {
            linkedAccountId = existingAccount.id;
          } else {
            // 🔴 ADDED: Create new account if none exists
            const newAccount = await tx.crm_Accounts.create({
              data: {
                name: account,
                type: "Prospect",
                status: "Inactive",
                description: `Account created automatically from web lead: ${firstName} ${lastName}`,
                v: 0,
              },
            });
            linkedAccountId = newAccount.id;
          }
        }

        // 🔴 MODIFIED: Create lead with enhanced data and proper field mapping
        const lead = await tx.crm_Leads.create({
          data: {
            v: 0, // 🔴 CHANGED: Updated version field (was v: 1)
            firstName,
            lastName,
            company: account,
            jobTitle: job,
            email,
            phone,
            lead_source: lead_source || source, // 🔴 ENHANCED: Better source tracking
            description: description || `Lead created from web form. Company: ${account}`, // 🔴 ADDED
            refered_by, // 🔴 ADDED
            campaign, // 🔴 ADDED
            status: "NEW",
            type: "DEMO",
            // 🔴 ADDED: Link to account if found/created
            accountsIDs: linkedAccountId,
            // 🔴 ADDED: Assign to user if provided
            assigned_to: assigned_to || null,
            // 🔴 ADDED: Track creation metadata
            createdBy: assigned_to || null,
            updatedBy: assigned_to || null,
          },
          // 🔴 ADDED: Include related data in response
          include: {
            assigned_accounts: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            assigned_to_user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        });

        // 🔴 ADDED: Create document relationships if provided
        if (documentIds.length > 0) {
          await tx.documentLeads.createMany({
            data: documentIds.map((documentId: string) => ({
              leadId: lead.id,
              documentId,
            })),
          });
        }

        return lead;
      });

      // 🔴 MODIFIED: Return more detailed response with created lead data
      return NextResponse.json({ 
        message: "New lead created successfully",
        lead: newLead,
        account_linked: !!newLead.accountsIDs,
        documents_linked: documentIds.length,
      }, { status: 201 });

    } catch (error) {
      console.log("[WEB_LEAD_CREATE_ERROR]", error);
      return NextResponse.json(
        { 
          message: "Error creating new lead", 
          details: error instanceof Error ? error.message : "Unknown error"
        },
        { status: 500 }
      );
    }
  }
}

// 🔴 ADDED: GET route to check API endpoint status and requirements
export async function GET(req: Request) {
  const token = req.headers.get("authorization");

  if (!token || token.trim() !== process.env.NEXTCRM_TOKEN?.trim()) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ 
    status: "active",
    endpoint: "create-lead-from-web",
    version: "2.0",
    required_fields: ["lastName"],
    optional_fields: [
      "firstName", "account", "job", "email", "phone", "lead_source",
      "description", "refered_by", "campaign", "assigned_to", "documentIds"
    ],
    features: [
      "automatic_account_creation",
      "document_linking",
      "user_assignment",
      "source_tracking"
    ]
  });
}