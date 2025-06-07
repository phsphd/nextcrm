// file: nextcrm/app/api/fulltext-search/route.ts
/*
This route provides comprehensive full-text search across all CRM modules
Searches opportunities, accounts, contacts, users, tasks, and projects

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model names to match Prisma schema (kept lowercase as per schema)
- Enhanced search functionality with better field selection
- Improved error handling and validation
- Added search result ranking and relevance
- Enhanced performance with optimized queries
- Added pagination and result limiting
- Better security with user permission checking
- Added search analytics and logging
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

interface SearchParams {
  query: string;
  modules?: string[];
  limit?: number;
  offset?: number;
  includeInactive?: boolean;
}

// Search result interface for type safety
interface SearchResult {
  id: string;
  title: string;
  description?: string;
  module: string;
  type: string;
  relevance: number;
  metadata?: Record<string, any>;
}

// Helper function to calculate relevance score
function calculateRelevance(item: any, searchTerm: string, fields: string[]): number {
  let score = 0;
  const term = searchTerm.toLowerCase();
  
  fields.forEach((field) => {
    const value = item[field]?.toString().toLowerCase() || '';
    if (value.includes(term)) {
      // Exact match gets higher score
      if (value === term) score += 10;
      // Starts with search term gets medium score
      else if (value.startsWith(term)) score += 5;
      // Contains search term gets base score
      else score += 1;
    }
  });
  
  return score;
}

// Helper function to transform results to unified format
function transformResults(items: any[], module: string, type: string, searchTerm: string): SearchResult[] {
  return items.map(item => {
    let title = '';
    let description = '';
    let relevance = 0;
    let metadata = {};

    switch (module) {
      case 'opportunities':
        title = item.name || 'Unnamed Opportunity';
        description = item.description;
        relevance = calculateRelevance(item, searchTerm, ['name', 'description']);
        metadata = {
          budget: item.budget,
          status: item.status,
          assigned_to: item.assigned_to,
        };
        break;
      
      case 'accounts':
        title = item.name || 'Unnamed Account';
        description = item.description;
        relevance = calculateRelevance(item, searchTerm, ['name', 'description', 'email']);
        metadata = {
          email: item.email,
          status: item.status,
          industry: item.industry,
        };
        break;
      
      case 'contacts':
        title = `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Unnamed Contact';
        description = item.description;
        relevance = calculateRelevance(item, searchTerm, ['first_name', 'last_name', 'email']);
        metadata = {
          email: item.email,
          position: item.position,
          status: item.status,
        };
        break;
      
      case 'users':
        title = item.name || item.username || item.email || 'Unnamed User';
        description = item.account_name;
        relevance = calculateRelevance(item, searchTerm, ['name', 'username', 'email', 'account_name']);
        metadata = {
          email: item.email,
          userStatus: item.userStatus,
          is_admin: item.is_admin,
        };
        break;
      
      case 'tasks':
        title = item.title || 'Unnamed Task';
        description = item.content;
        relevance = calculateRelevance(item, searchTerm, ['title', 'content']);
        metadata = {
          taskStatus: item.taskStatus,
          priority: item.priority,
          user: item.user,
        };
        break;
      
      case 'projects':
        title = item.title || 'Unnamed Project';
        description = item.description;
        relevance = calculateRelevance(item, searchTerm, ['title', 'description']);
        metadata = {
          user: item.user,
          favourite: item.favourite,
        };
        break;
      
      default:
        title = 'Unknown Item';
        description = '';
        relevance = 0;
    }

    return {
      id: item.id,
      title,
      description: description || '',
      module,
      type,
      relevance,
      metadata,
    };
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { data: requestData } = body;
    
    // Enhanced parameter parsing
    const searchParams: SearchParams = {
      query: requestData?.data || requestData?.query || requestData,
      modules: requestData?.modules || ['opportunities', 'accounts', 'contacts', 'users', 'tasks', 'projects'],
      limit: Math.min(requestData?.limit || 50, 100), // Max 100 results per module
      offset: requestData?.offset || 0,
      includeInactive: requestData?.includeInactive || false,
    };

    const searchTerm = searchParams.query;

    // Validate search term
    if (!searchTerm || typeof searchTerm !== 'string') {
      return NextResponse.json(
        { error: "Search query is required and must be a string" },
        { status: 400 }
      );
    }

    if (searchTerm.trim().length < 2) {
      return NextResponse.json(
        { error: "Search query must be at least 2 characters long" },
        { status: 400 }
      );
    }

    const trimmedSearch = searchTerm.trim();
    console.log(`User ${session.user.email} searching for: "${trimmedSearch}"`);

    const searchResults: { [key: string]: SearchResult[] } = {};
    let totalResults = 0;

    // Search in CRM Opportunities
    if (searchParams.modules.includes('opportunities')) {
      try {
        const opportunities = await prismadb.crm_Opportunities.findMany({
          where: {
            OR: [
              { name: { contains: trimmedSearch, mode: "insensitive" } },
              { description: { contains: trimmedSearch, mode: "insensitive" } },
              { next_step: { contains: trimmedSearch, mode: "insensitive" } },
            ],
            ...(searchParams.includeInactive ? {} : { status: "ACTIVE" }),
          },
          select: {
            id: true,
            name: true,
            description: true,
            budget: true,
            status: true,
            assigned_to: true,
            next_step: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.opportunities = transformResults(opportunities, 'opportunities', 'Opportunity', trimmedSearch);
        totalResults += opportunities.length;
      } catch (error) {
        console.error("Error searching opportunities:", error);
        searchResults.opportunities = [];
      }
    }

    // Search in CRM Accounts
    if (searchParams.modules.includes('accounts')) {
      try {
        const accounts = await prismadb.crm_Accounts.findMany({
          where: {
            OR: [
              { name: { contains: trimmedSearch, mode: "insensitive" } },
              { description: { contains: trimmedSearch, mode: "insensitive" } },
              { email: { contains: trimmedSearch, mode: "insensitive" } },
              { company_id: { contains: trimmedSearch, mode: "insensitive" } },
            ],
            ...(searchParams.includeInactive ? {} : { status: "Active" }),
          },
          select: {
            id: true,
            name: true,
            description: true,
            email: true,
            status: true,
            industry: true,
            company_id: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.accounts = transformResults(accounts, 'accounts', 'Account', trimmedSearch);
        totalResults += accounts.length;
      } catch (error) {
        console.error("Error searching accounts:", error);
        searchResults.accounts = [];
      }
    }

    // Search in CRM Contacts
    if (searchParams.modules.includes('contacts')) {
      try {
        const contacts = await prismadb.crm_Contacts.findMany({
          where: {
            OR: [
              { first_name: { contains: trimmedSearch, mode: "insensitive" } },
              { last_name: { contains: trimmedSearch, mode: "insensitive" } },
              { email: { contains: trimmedSearch, mode: "insensitive" } },
              { personal_email: { contains: trimmedSearch, mode: "insensitive" } },
              { position: { contains: trimmedSearch, mode: "insensitive" } },
            ],
            ...(searchParams.includeInactive ? {} : { status: true }),
          },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            email: true,
            personal_email: true,
            position: true,
            status: true,
            description: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.contacts = transformResults(contacts, 'contacts', 'Contact', trimmedSearch);
        totalResults += contacts.length;
      } catch (error) {
        console.error("Error searching contacts:", error);
        searchResults.contacts = [];
      }
    }

    // Search in Users (with privacy considerations)
    if (searchParams.modules.includes('users') && session.user.is_admin) {
      try {
        const users = await prismadb.users.findMany({
          where: {
            OR: [
              { name: { contains: trimmedSearch, mode: "insensitive" } },
              { username: { contains: trimmedSearch, mode: "insensitive" } },
              { email: { contains: trimmedSearch, mode: "insensitive" } },
              { account_name: { contains: trimmedSearch, mode: "insensitive" } },
            ],
            ...(searchParams.includeInactive ? {} : { userStatus: "ACTIVE" }),
          },
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            account_name: true,
            userStatus: true,
            is_admin: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.users = transformResults(users, 'users', 'User', trimmedSearch);
        totalResults += users.length;
      } catch (error) {
        console.error("Error searching users:", error);
        searchResults.users = [];
      }
    }

    // Search in Tasks
    if (searchParams.modules.includes('tasks')) {
      try {
        const tasks = await prismadb.tasks.findMany({
          where: {
            OR: [
              { title: { contains: trimmedSearch, mode: "insensitive" } },
              { content: { contains: trimmedSearch, mode: "insensitive" } },
            ],
            ...(searchParams.includeInactive ? {} : { taskStatus: { not: "COMPLETE" } }),
          },
          select: {
            id: true,
            title: true,
            content: true,
            taskStatus: true,
            priority: true,
            user: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.tasks = transformResults(tasks, 'tasks', 'Task', trimmedSearch);
        totalResults += tasks.length;
      } catch (error) {
        console.error("Error searching tasks:", error);
        searchResults.tasks = [];
      }
    }

    // Search in Projects/Boards
    if (searchParams.modules.includes('projects')) {
      try {
        const projects = await prismadb.boards.findMany({
          where: {
            OR: [
              { title: { contains: trimmedSearch, mode: "insensitive" } },
              { description: { contains: trimmedSearch, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            title: true,
            description: true,
            user: true,
            favourite: true,
          },
          take: searchParams.limit,
          skip: searchParams.offset,
        });

        searchResults.projects = transformResults(projects, 'projects', 'Project', trimmedSearch);
        totalResults += projects.length;
      } catch (error) {
        console.error("Error searching projects:", error);
        searchResults.projects = [];
      }
    }

    // Flatten and sort all results by relevance
    const allResults: SearchResult[] = Object.values(searchResults).flat();
    const sortedResults = allResults.sort((a, b) => b.relevance - a.relevance);

    console.log(`Search completed for "${trimmedSearch}": ${totalResults} total results found`);

    return NextResponse.json(
      {
        success: true,
        query: trimmedSearch,
        totalResults,
        resultsByModule: searchResults,
        topResults: sortedResults.slice(0, 20), // Top 20 most relevant results
        searchParams,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[FULLTEXT_SEARCH_POST] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Search failed",
        details: errorMessage,
        query: req.body?.data || "unknown"
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for search suggestions/autocomplete
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 20);

    if (!query || query.length < 2) {
      return NextResponse.json(
        { suggestions: [], message: "Query too short for suggestions" },
        { status: 200 }
      );
    }

    // Get quick suggestions from different modules
    const suggestions = await Promise.all([
      // Account names
      prismadb.crm_Accounts.findMany({
        where: {
          name: { contains: query, mode: "insensitive" },
          status: "Active"
        },
        select: { id: true, name: true },
        take: limit / 4,
      }),
      // Contact names
      prismadb.crm_Contacts.findMany({
        where: {
          OR: [
            { first_name: { contains: query, mode: "insensitive" } },
            { last_name: { contains: query, mode: "insensitive" } }
          ],
          status: true
        },
        select: { id: true, first_name: true, last_name: true },
        take: limit / 4,
      }),
    ]);

    const formattedSuggestions = [
      ...suggestions[0].map(account => ({
        id: account.id,
        text: account.name,
        type: 'account'
      })),
      ...suggestions[1].map(contact => ({
        id: contact.id,
        text: `${contact.first_name} ${contact.last_name}`.trim(),
        type: 'contact'
      })),
    ].slice(0, limit);

    return NextResponse.json(
      {
        suggestions: formattedSuggestions,
        query
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[SEARCH_SUGGESTIONS_GET] Error:", error);
    
    return NextResponse.json(
      { suggestions: [], error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}