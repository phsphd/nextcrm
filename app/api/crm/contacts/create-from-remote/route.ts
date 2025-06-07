// file: nextcrm/app/api/crm/contacts/create-from-remote/route.ts
import { prismadb } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiKey = req.headers.get("NEXTCRM_TOKEN");

  // Get API key from headers
  if (!apiKey) {
    return NextResponse.json({ error: "API key is missing" }, { status: 401 });
  }

  // Here you would typically check the API key against a stored value
  // For example, you could fetch it from a database or environment variable
  const storedApiKey = process.env.NEXTCRM_TOKEN; // Example of fetching from env
  if (apiKey !== storedApiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json();

  console.log(body, "body");

  const { 
    name, 
    surname, 
    email, 
    phone, 
    company, 
    message, 
    tag,
    // 🔴 ADDED: Optional fields for better contact management
    assigned_to,
    account_id,
    position,
    source = "remote_api" // Default source tracking
  } = body;

  if (!name || !surname || !email || !phone || !company || !message || !tag) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  try {
    // 🔴 MODIFIED: Use transaction to handle potential account linking
    const newContact = await prismadb.$transaction(async (tx) => {
      // 🔴 ADDED: Try to find or create account if company name is provided
      let linkedAccountId = account_id;
      
      if (company && !account_id) {
        // Try to find existing account by company name
        const existingAccount = await tx.crm_Accounts.findFirst({
          where: {
            name: {
              equals: company,
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
              name: company,
              type: "Prospect",
              status: "Inactive",
              description: `Account created automatically from remote contact: ${name} ${surname}`,
              v: 0,
            },
          });
          linkedAccountId = newAccount.id;
        }
      }

      // 🔴 MODIFIED: Create contact with enhanced data and proper field mapping
      const contact = await tx.crm_Contacts.create({
        data: {
          v: 0, // 🔴 ADDED: Required version field
          first_name: name,
          last_name: surname,
          email,
          mobile_phone: phone,
          position: position || null, // 🔴 ADDED: Position field
          type: "Prospect",
          status: true, // 🔴 ADDED: Default active status
          tags: [tag, source], // 🔴 MODIFIED: Include source tag
          notes: [
            `Account: ${company}`, 
            `Message: ${message}`,
            `Source: ${source}`,
            `Created: ${new Date().toISOString()}`
          ], // 🔴 ENHANCED: More detailed notes
          // 🔴 ADDED: Link to account if found/created
          accountsIDs: linkedAccountId || null,
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

      return contact;
    });

    // 🔴 MODIFIED: Return more detailed response with created contact data
    return NextResponse.json({ 
      message: "Contact created successfully", 
      contact: newContact,
      account_linked: !!newContact.accountsIDs,
    }, { status: 201 });

  } catch (error) {
    console.log("[REMOTE_CONTACT_CREATE_ERROR]", error);
    return NextResponse.json(
      { error: "Error creating contact", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// 🔴 ADDED: GET route to check API endpoint status
export async function GET(req: Request) {
  const apiKey = req.headers.get("NEXTCRM_TOKEN");

  if (!apiKey) {
    return NextResponse.json({ error: "API key is missing" }, { status: 401 });
  }

  const storedApiKey = process.env.NEXTCRM_TOKEN;
  if (apiKey !== storedApiKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  return NextResponse.json({ 
    status: "active",
    endpoint: "create-from-remote",
    version: "2.0",
    supported_fields: [
      "name", "surname", "email", "phone", "company", "message", "tag",
      "assigned_to", "account_id", "position", "source"
    ]
  });
}