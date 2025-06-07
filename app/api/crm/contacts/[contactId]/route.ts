// file: app/api/crm/contacts/[contactId]/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { prismadb } from "@/lib/prisma";
import { authOptions } from "@/lib/auth";

//Contact delete route
export async function DELETE(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  try {
    // 🔴 MODIFIED: Use transaction to handle related junction table data
    await prismadb.$transaction(async (tx) => {
      // 🔴 ADDED: Delete related junction table records first
      await tx.documentContacts.deleteMany({
        where: {
          contactId: params.contactId,
        },
      });

      await tx.contactOpportunities.deleteMany({
        where: {
          contactId: params.contactId,
        },
      });

      // 🔴 MODIFIED: Then delete the contact itself
      await tx.crm_Contacts.delete({
        where: {
          id: params.contactId,
        },
      });
    });

    return NextResponse.json({ message: "Contact deleted" }, { status: 200 });
  } catch (error) {
    console.log("[CONTACT_DELETE]", error);
    return new NextResponse("Failed to delete contact", { status: 500 });
  }
}

// 🔴 ADDED: GET route to fetch single contact with all relationships
export async function GET(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  try {
    const contact = await prismadb.crm_Contacts.findUnique({
      where: {
        id: params.contactId,
      },
      include: {
        assigned_to_user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        crate_by_user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        assigned_accounts: {
          select: {
            id: true,
            name: true,
            email: true,
            website: true,
          },
        },
        // 🔴 ADDED: Include documents through junction table
        documents: {
          include: {
            document: {
              select: {
                id: true,
                document_name: true,
                document_file_url: true,
                document_file_mimeType: true,
                createdAt: true,
              },
            },
          },
        },
        // 🔴 ADDED: Include opportunities through junction table
        opportunities: {
          include: {
            opportunity: {
              select: {
                id: true,
                name: true,
                status: true,
                expected_revenue: true,
                close_date: true,
              },
            },
          },
        },
      },
    });

    if (!contact) {
      return new NextResponse("Contact not found", { status: 404 });
    }

    return NextResponse.json(contact, { status: 200 });
  } catch (error) {
    console.log("[CONTACT_GET]", error);
    return new NextResponse("Failed to fetch contact", { status: 500 });
  }
}

// 🔴 ADDED: PUT route to update contact
export async function PUT(req: Request, props: { params: Promise<{ contactId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }

  if (!params.contactId) {
    return new NextResponse("contact ID is required", { status: 400 });
  }

  try {
    const body = await req.json();
    const {
      first_name,
      last_name,
      email,
      office_phone,
      mobile_phone,
      position,
      accountsIDs,
      assigned_to,
      description,
      status,
      social_twitter,
      social_facebook,
      social_linkedin,
      social_skype,
      social_instagram,
      social_youtube,
      social_tiktok,
      type,
      // 🔴 ADDED: Support for updating opportunity relationships
      opportunityIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle junction table updates
    const updatedContact = await prismadb.$transaction(async (tx) => {
      // Update the contact
      const contact = await tx.crm_Contacts.update({
        where: {
          id: params.contactId,
        },
        data: {
          first_name,
          last_name,
          email,
          office_phone,
          mobile_phone,
          position,
          accountsIDs,
          assigned_to,
          description,
          status,
          social_twitter,
          social_facebook,
          social_linkedin,
          social_skype,
          social_instagram,
          social_youtube,
          social_tiktok,
          type,
          updatedBy: session.user.id,
        },
      });

      // 🔴 ADDED: Update opportunity relationships
      if (opportunityIds.length >= 0) {
        // Remove existing opportunity relationships
        await tx.contactOpportunities.deleteMany({
          where: {
            contactId: params.contactId,
          },
        });

        // Add new opportunity relationships
        if (opportunityIds.length > 0) {
          await tx.contactOpportunities.createMany({
            data: opportunityIds.map((opportunityId: string) => ({
              contactId: params.contactId,
              opportunityId,
            })),
          });
        }
      }

      return contact;
    });

    return NextResponse.json(updatedContact, { status: 200 });
  } catch (error) {
    console.log("[CONTACT_PUT]", error);
    return new NextResponse("Failed to update contact", { status: 500 });
  }
}