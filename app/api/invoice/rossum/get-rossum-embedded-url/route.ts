// file: nextcrm/app/api/invoice/rossum/get-rossum-embedded-url/route.ts
/*
This route creates an embedded URL for Rossum annotation viewing/editing
No database migration needed - this only handles Rossum API integration

IMPROVEMENTS MADE:
- Enhanced error handling and logging
- Added input validation
- Improved response consistency
- Better error messages for debugging
- Added request/response logging for monitoring
*/
import { authOptions } from "@/lib/auth";
import { getRossumToken } from "@/lib/get-rossum-token";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { rossum_annotation_url: embUrl } = body;

    // Validate required fields
    if (!embUrl) {
      return NextResponse.json(
        { error: "Missing required field: rossum_annotation_url" }, 
        { status: 400 }
      );
    }

    console.log(`Creating embedded URL for annotation: ${embUrl}`);

    // Get Rossum authentication token
    const token = await getRossumToken();

    if (!token) {
      console.error("Failed to obtain Rossum authentication token");
      return NextResponse.json(
        { error: "Failed to authenticate with Rossum API" }, 
        { status: 500 }
      );
    }

    // Create embedded URL via Rossum API
    const embeddedUrlEndpoint = `${embUrl}/create_embedded_url`;
    console.log(`Making request to: ${embeddedUrlEndpoint}`);

    const response = await fetch(embeddedUrlEndpoint, {
      method: "POST",
      headers: { 
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
    });

    if (!response.ok) {
      console.error(`Rossum API error: ${response.status} ${response.statusText}`);
      return NextResponse.json(
        { error: `Rossum API error: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    console.log("Successfully created embedded URL");
    
    return NextResponse.json(
      { 
        success: true,
        embedded_url: data.url || data,
        data: data
      }, 
      { status: 200 }
    );

  } catch (error) {
    console.error("Error creating Rossum embedded URL:", error);
    
    // Return more specific error information
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      { 
        error: "Failed to create embedded URL",
        details: errorMessage
      }, 
      { status: 500 }
    );
  }
}