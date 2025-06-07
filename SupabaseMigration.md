# NextCRM MongoDB to Supabase Migration Guide

This guide will help you replace MongoDB with Supabase (PostgreSQL) in the NextCRM application, following the patterns from the contacts app.

## Overview

**Current NextCRM Stack:**
- Next.js 15 + TypeScript
- Prisma ORM with MongoDB
- Auth.js for authentication
- Shadcn/ui components

**Target Stack:**
- Next.js 15 + TypeScript
- Supabase (PostgreSQL) with Prisma ORM
- Supabase Auth (optional) or keep Auth.js
- Shadcn/ui components (unchanged)

## Phase 1: Environment Setup

### 1.1 Install Supabase Dependencies

```bash
npm install @supabase/supabase-js --legacy-peer-deps
npm install @supabase/ssr --legacy-peer-deps
```

### 1.2 Update Environment Variables

Replace your `.env` file:

```bash
# Remove MongoDB URL
# DATABASE_URL="mongodb+srv://..."

# Add Supabase configuration
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Update Prisma URL for PostgreSQL
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-us-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres"
```

## Phase 2: Complete Database Schema Migration

### 2.1 Replace Prisma Schema

Replace your `prisma/schema.prisma` with this complete PostgreSQL version:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// === ENUMS ===
enum crm_Lead_Status {
  NEW
  CONTACTED
  QUALIFIED
  LOST
}

enum crm_Lead_Type {
  DEMO
}

enum crm_Opportunity_Status {
  ACTIVE
  INACTIVE
  PENDING
  CLOSED
}

enum crm_Contracts_Status {
  NOTSTARTED
  INPROGRESS
  SIGNED
}

enum crm_Contact_Type {
  Customer
  Partner
  Vendor
  Prospect
}

enum DocumentSystemType {
  INVOICE
  RECEIPT
  CONTRACT
  OFFER
  OTHER
}

enum taskStatus {
  ACTIVE
  PENDING
  COMPLETE
}

enum ActiveStatus {
  ACTIVE
  INACTIVE
  PENDING
}

enum Language {
  cz
  en
  de
  uk
}

enum gptStatus {
  ACTIVE
  INACTIVE
}

// === JUNCTION TABLES FOR MANY-TO-MANY RELATIONS ===
model UserWatchingBoards {
  id      String @id @default(cuid())
  userId  String
  boardId String
  user    Users  @relation(name: "user_watching_boards", fields: [userId], references: [id], onDelete: Cascade)
  board   Boards @relation(name: "board_watchers", fields: [boardId], references: [id], onDelete: Cascade)
  
  @@unique([userId, boardId])
  @@map("nextcrm_user_watching_boards")
}

model UserWatchingAccounts {
  id        String       @id @default(cuid())
  userId    String
  accountId String
  user      Users        @relation(name: "user_watching_accounts", fields: [userId], references: [id], onDelete: Cascade)
  account   crm_Accounts @relation(name: "account_watchers", fields: [accountId], references: [id], onDelete: Cascade)
  
  @@unique([userId, accountId])
  @@map("nextcrm_user_watching_accounts")
}

model DocumentInvoices {
  id         String    @id @default(cuid())
  documentId String
  invoiceId  String
  document   Documents @relation(name: "document_invoices", fields: [documentId], references: [id], onDelete: Cascade)
  invoice    Invoices  @relation(name: "invoice_documents", fields: [invoiceId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, invoiceId])
  @@map("nextcrm_document_invoices")
}

model DocumentOpportunities {
  id            String            @id @default(cuid())
  documentId    String
  opportunityId String
  document      Documents         @relation(name: "document_opportunities", fields: [documentId], references: [id], onDelete: Cascade)
  opportunity   crm_Opportunities @relation(name: "opportunity_documents", fields: [opportunityId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, opportunityId])
  @@map("nextcrm_document_opportunities")
}

model DocumentContacts {
  id         String       @id @default(cuid())
  documentId String
  contactId  String
  document   Documents    @relation(name: "document_contacts", fields: [documentId], references: [id], onDelete: Cascade)
  contact    crm_Contacts @relation(name: "contact_documents", fields: [contactId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, contactId])
  @@map("nextcrm_document_contacts")
}

model DocumentTasks {
  id         String    @id @default(cuid())
  documentId String
  taskId     String
  document   Documents @relation(name: "document_tasks", fields: [documentId], references: [id], onDelete: Cascade)
  task       Tasks     @relation(name: "task_documents", fields: [taskId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, taskId])
  @@map("nextcrm_document_tasks")
}

model DocumentLeads {
  id         String    @id @default(cuid())
  documentId String
  leadId     String
  document   Documents @relation(name: "document_leads", fields: [documentId], references: [id], onDelete: Cascade)
  lead       crm_Leads @relation(name: "lead_documents", fields: [leadId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, leadId])
  @@map("nextcrm_document_leads")
}

model DocumentAccounts {
  id         String       @id @default(cuid())
  documentId String
  accountId  String
  document   Documents    @relation(name: "document_accounts", fields: [documentId], references: [id], onDelete: Cascade)
  account    crm_Accounts @relation(name: "account_documents", fields: [accountId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, accountId])
  @@map("nextcrm_document_accounts")
}

model ContactOpportunities {
  id            String            @id @default(cuid())
  contactId     String
  opportunityId String
  contact       crm_Contacts      @relation(name: "contact_opportunities", fields: [contactId], references: [id], onDelete: Cascade)
  opportunity   crm_Opportunities @relation(name: "opportunity_contacts", fields: [opportunityId], references: [id], onDelete: Cascade)
  
  @@unique([contactId, opportunityId])
  @@map("nextcrm_contact_opportunities")
}

// === CORE USER MANAGEMENT ===
model Users {
  id                   String                @id @default(cuid())
  v                    Int                   @default(0)
  account_name         String?
  avatar               String?
  email                String                @unique
  is_account_admin     Boolean               @default(false)
  is_admin             Boolean               @default(false)
  created_on           DateTime              @default(now())
  lastLoginAt          DateTime?
  name                 String?
  password             String?
  username             String?
  userStatus           ActiveStatus          @default(PENDING)
  userLanguage         Language              @default(en)
  
  // Relations
  tasksComment         tasksComments[]
  created_by_documents Documents[]           @relation(name: "created_by_user")
  assigned_documents   Documents[]           @relation(name: "assigned_to_user")
  tasks                Tasks[]
  crm_accounts_tasks   crm_Accounts_Tasks[]
  accounts             crm_Accounts[]
  leads                crm_Leads[]
  created_by_user      crm_Opportunities[]   @relation(name: "created_by_user_relation")
  assigned_opportunity crm_Opportunities[]   @relation(name: "assigned_to_user_relation")
  assigned_contacts    crm_Contacts[]        @relation(name: "assigned_contacts")
  crated_contacts      crm_Contacts[]        @relation(name: "created_contacts")
  notion_account       secondBrain_notions[]
  openAi_key           openAi_keys[]
  assigned_invoices    Invoices[]
  assigned_contracts   crm_Contracts[]
  boards               Boards[]              @relation(name: "assigned_user")
  
  // Many-to-many through junction tables
  watching_boards      UserWatchingBoards[]  @relation(name: "user_watching_boards")
  watching_accounts    UserWatchingAccounts[] @relation(name: "user_watching_accounts")
  
  @@map("nextcrm_users")
}

// === CRM ACCOUNTS ===
model crm_Accounts {
  id                   String               @id @default(cuid())
  v                    Int
  createdAt            DateTime             @default(now())
  createdBy            String?
  updatedAt            DateTime?            @updatedAt
  updatedBy            String?
  annual_revenue       String?
  assigned_to          String?
  billing_city         String?
  billing_country      String?
  billing_postal_code  String?
  billing_state        String?
  billing_street       String?
  company_id           String?
  description          String?
  email                String?
  employees            String?
  fax                  String?
  industry             String?
  member_of            String?
  name                 String
  office_phone         String?
  shipping_city        String?
  shipping_country     String?
  shipping_postal_code String?
  shipping_state       String?
  shipping_street      String?
  status               String?              @default("Inactive")
  type                 String?              @default("Customer")
  vat                  String?
  website              String?
  
  // Relations
  invoices             Invoices[]
  contacts             crm_Contacts[]
  leads                crm_Leads[]
  industry_type        crm_Industry_Type?   @relation(fields: [industry], references: [id])
  opportunities        crm_Opportunities[]
  assigned_to_user     Users?               @relation(fields: [assigned_to], references: [id])
  crm_accounts_tasks   crm_Accounts_Tasks[]
  contracts            crm_Contracts[]
  
  // Many-to-many through junction tables
  documents            DocumentAccounts[]   @relation(name: "account_documents")
  watchers             UserWatchingAccounts[] @relation(name: "account_watchers")
  
  @@map("nextcrm_crm_accounts")
}

// === CRM LEADS ===
model crm_Leads {
  id                 String        @id @default(cuid())
  v                  Int           @default(0)
  createdAt          DateTime?     @default(now())
  createdBy          String?
  updatedAt          DateTime?     @updatedAt
  updatedBy          String?
  firstName          String?
  lastName           String
  company            String?
  jobTitle           String?
  email              String?
  phone              String?
  description        String?
  lead_source        String?
  refered_by         String?
  campaign           String?
  status             String?       @default("NEW")
  type               String?       @default("DEMO")
  assigned_to        String?
  accountsIDs        String?
  
  // Relations
  assigned_to_user   Users?        @relation(fields: [assigned_to], references: [id])
  assigned_accounts  crm_Accounts? @relation(fields: [accountsIDs], references: [id])
  
  // Many-to-many through junction tables
  documents          DocumentLeads[] @relation(name: "lead_documents")
  
  @@map("nextcrm_crm_leads")
}

// === CRM OPPORTUNITIES ===
model crm_Opportunities {
  id                   String                          @id @default(cuid())
  v                    Int                             @default(0)
  account              String?
  assigned_to          String?
  budget               Int                             @default(0)
  campaign             String?
  close_date           DateTime?
  contact              String?
  created_by           String?
  createdBy            String?
  created_on           DateTime?                       @default(now())
  createdAt            DateTime                        @default(now())
  last_activity        DateTime?
  updatedAt            DateTime?                       @updatedAt
  updatedBy            String?
  last_activity_by     String?
  currency             String?
  description          String?
  expected_revenue     Int                             @default(0)
  name                 String?
  next_step            String?
  sales_stage          String?
  type                 String?
  status               crm_Opportunity_Status?         @default(ACTIVE)
  
  // Relations
  assigned_type        crm_Opportunities_Type?         @relation(fields: [type], references: [id])
  assigned_sales_stage crm_Opportunities_Sales_Stages? @relation(name: "assinged_sales_stage", fields: [sales_stage], references: [id])
  assigned_to_user     Users?                          @relation(name: "assigned_to_user_relation", fields: [assigned_to], references: [id])
  created_by_user      Users?                          @relation(name: "created_by_user_relation", fields: [created_by], references: [id])
  assigned_account     crm_Accounts?                   @relation(fields: [account], references: [id])
  assigned_campaings   crm_campaigns?                  @relation(fields: [campaign], references: [id])
  
  // Many-to-many through junction tables
  documents            DocumentOpportunities[]         @relation(name: "opportunity_documents")
  contacts             ContactOpportunities[]          @relation(name: "opportunity_contacts")
  
  @@map("nextcrm_crm_opportunities")
}

// === CRM CAMPAIGNS ===
model crm_campaigns {
  id            String              @id @default(cuid())
  v             Int
  name          String
  description   String?
  status        String?
  opportunities crm_Opportunities[]
  
  @@map("nextcrm_crm_campaigns")
}

// === CRM OPPORTUNITY SALES STAGES ===
model crm_Opportunities_Sales_Stages {
  id                                 String              @id @default(cuid())
  v                                  Int
  name                               String
  probability                        Int?
  order                              Int?
  assigned_opportunities_sales_stage crm_Opportunities[] @relation(name: "assinged_sales_stage")
  
  @@map("nextcrm_crm_opportunities_sales_stages")
}

// === CRM OPPORTUNITY TYPES ===
model crm_Opportunities_Type {
  id                     String              @id @default(cuid())
  v                      Int
  name                   String
  order                  Int?
  assigned_opportunities crm_Opportunities[]
  
  @@map("nextcrm_crm_opportunities_type")
}

// === CRM CONTACTS ===
model crm_Contacts {
  id                     String              @id @default(cuid())
  v                      Int                 @default(0)
  account                String?
  assigned_to            String?
  birthday               String?
  created_by             String?
  createdBy              String?
  created_on             DateTime?           @default(now())
  cratedAt               DateTime?           @default(now())
  last_activity          DateTime?           @default(now())
  updatedAt              DateTime?           @updatedAt
  updatedBy              String?
  last_activity_by       String?
  description            String?
  email                  String?
  personal_email         String?
  first_name             String?
  last_name              String
  office_phone           String?
  mobile_phone           String?
  website                String?
  position               String?
  status                 Boolean             @default(true)
  social_twitter         String?
  social_facebook        String?
  social_linkedin        String?
  social_skype           String?
  social_instagram       String?
  social_youtube         String?
  social_tiktok          String?
  type                   String?             @default("Customer")
  tags                   String[]
  notes                  String[]
  accountsIDs            String?
  
  // Relations
  assigned_to_user       Users?              @relation(name: "assigned_contacts", fields: [assigned_to], references: [id])
  crate_by_user          Users?              @relation(name: "created_contacts", fields: [created_by], references: [id])
  assigned_accounts      crm_Accounts?       @relation(fields: [accountsIDs], references: [id])
  
  // Many-to-many through junction tables
  opportunities          ContactOpportunities[] @relation(name: "contact_opportunities")
  documents              DocumentContacts[]     @relation(name: "contact_documents")
  
  @@map("nextcrm_crm_contacts")
}

// === CRM CONTRACTS ===
model crm_Contracts {
  id                  String               @id @default(cuid())
  v                   Int
  title               String
  value               Int
  startDate           DateTime?            @default(now())
  endDate             DateTime?
  renewalReminderDate DateTime?
  customerSignedDate  DateTime?
  companySignedDate   DateTime?
  description         String?
  account             String?
  assigned_to         String?
  createdAt           DateTime?            @default(now())
  createdBy           String?
  updatedAt           DateTime?            @updatedAt
  updatedBy           String?
  status              crm_Contracts_Status @default(NOTSTARTED)
  type                String?
  
  // Relations
  assigned_account    crm_Accounts?        @relation(fields: [account], references: [id])
  assigned_to_user    Users?               @relation(fields: [assigned_to], references: [id])
  
  @@map("nextcrm_crm_contracts")
}

// === INDUSTRY TYPES ===
model crm_Industry_Type {
  id       String         @id @default(cuid())
  v        Int
  name     String
  accounts crm_Accounts[]
  
  @@map("nextcrm_crm_industry_type")
}

// === BOARDS & TASKS ===
model Boards {
  id                String    @id @default(cuid())
  v                 Int
  description       String
  favourite         Boolean?
  favouritePosition Int?
  icon              String?
  position          Int?
  title             String
  user              String
  visibility        String?
  sharedWith        String[]
  createdAt         DateTime? @default(now())
  createdBy         String?
  updatedAt         DateTime? @updatedAt
  updatedBy         String?
  
  // Relations
  assigned_user  Users?   @relation(name: "assigned_user", fields: [user], references: [id])
  
  // Many-to-many through junction tables
  watchers       UserWatchingBoards[] @relation(name: "board_watchers")
  
  @@map("nextcrm_boards")
}

model Tasks {
  id               String          @id @default(cuid())
  v                Int
  content          String?
  createdAt        DateTime?       @default(now())
  createdBy        String?
  updatedAt        DateTime?       @updatedAt
  updatedBy        String?
  dueDateAt        DateTime?       @default(now())
  lastEditedAt     DateTime?       @default(now()) @updatedAt
  position         Int
  priority         String
  section          String?
  tags             Json?
  title            String
  likes            Int?            @default(0)
  user             String?
  taskStatus       taskStatus?     @default(ACTIVE)
  
  // Relations
  comments         tasksComments[]
  assigned_user    Users?          @relation(fields: [user], references: [id])
  assigned_section Sections?       @relation(fields: [section], references: [id])
  
  // Many-to-many through junction tables
  documents        DocumentTasks[] @relation(name: "task_documents")
  
  @@map("nextcrm_tasks")
}

model crm_Accounts_Tasks {
  id            String          @id @default(cuid())
  v             Int
  content       String?
  createdAt     DateTime?       @default(now())
  createdBy     String?
  updatedAt     DateTime?       @updatedAt
  updatedBy     String?
  dueDateAt     DateTime?       @default(now())
  priority      String
  tags          Json?
  title         String
  likes         Int?            @default(0)
  user          String?
  account       String?
  taskStatus    taskStatus?     @default(ACTIVE)
  
  // Relations
  comments      tasksComments[]
  documents     Documents[]
  assigned_user Users?          @relation(fields: [user], references: [id])
  crm_accounts  crm_Accounts?   @relation(fields: [account], references: [id])
  
  @@map("nextcrm_crm_accounts_tasks")
}

model tasksComments {
  id                             String              @id @default(cuid())
  v                              Int
  comment                        String
  createdAt                      DateTime            @default(now())
  task                           String
  user                           String
  assigned_crm_account_task      String?
  
  // Relations
  assigned_crm_account_task_task crm_Accounts_Tasks? @relation(fields: [assigned_crm_account_task], references: [id])
  assigned_task                  Tasks?              @relation(fields: [task], references: [id], onDelete: Cascade)
  assigned_user                  Users?              @relation(fields: [user], references: [id])
  
  @@map("nextcrm_tasks_comments")
}

model Sections {
  id       String  @id @default(cuid())
  v        Int
  board    String
  title    String
  position Int?
  tasks    Tasks[]
  
  @@map("nextcrm_sections")
}

// === DOCUMENTS ===
model Documents {
  id                     String              @id @default(cuid())
  v                      Int?
  date_created           DateTime?           @default(now())
  createdAt              DateTime?           @default(now())
  last_updated           DateTime?           @updatedAt
  updatedAt              DateTime?           @updatedAt
  document_name          String
  created_by_user        String?
  createdBy              String?
  description            String?
  document_type          String?
  favourite              Boolean?
  document_file_mimeType String
  document_file_url      String
  status                 String?
  visibility             String?
  tags                   Json?
  key                    String?
  size                   Int?
  assigned_user          String?
  connected_documents    String[]
  document_system_type   DocumentSystemType? @default(OTHER)
  
  // Relations
  created_by             Users?              @relation(name: "created_by_user", fields: [created_by_user], references: [id])
  assigned_to_user       Users?              @relation(name: "assigned_to_user", fields: [assigned_user], references: [id])
  documents_type         Documents_Types?    @relation(fields: [document_type], references: [id])
  crm_accounts_tasks     crm_Accounts_Tasks[]
  
  // Many-to-many through junction tables
  invoices               DocumentInvoices[]    @relation(name: "document_invoices")
  opportunities          DocumentOpportunities[] @relation(name: "document_opportunities")
  contacts               DocumentContacts[]    @relation(name: "document_contacts")
  tasks                  DocumentTasks[]       @relation(name: "document_tasks")
  leads                  DocumentLeads[]       @relation(name: "document_leads")
  accounts               DocumentAccounts[]    @relation(name: "document_accounts")
  
  @@map("nextcrm_documents")
}

model Documents_Types {
  id                 String      @id @default(cuid())
  v                  Int
  name               String
  assigned_documents Documents[]
  
  @@map("nextcrm_documents_types")
}

// === INVOICES ===
model Invoices {
  id                            String          @id @default(cuid())
  v                             Int?
  date_created                  DateTime        @default(now())
  last_updated                  DateTime        @updatedAt
  last_updated_by               String?
  date_received                 DateTime?       @default(now())
  date_of_case                  DateTime?
  date_tax                      DateTime?
  date_due                      DateTime?
  description                   String?
  document_type                 String?
  favorite                      Boolean?        @default(false)
  variable_symbol               String?
  constant_symbol               String?
  specific_symbol               String?
  order_number                  String?
  internal_number               String?
  invoice_number                String?
  invoice_amount                String?
  invoice_file_mimeType         String
  invoice_file_url              String
  invoice_items                 Json?
  invoice_type                  String?
  invoice_currency              String?
  invoice_language              String?
  partner                       String?
  partner_street                String?
  partner_city                  String?
  partner_zip                   String?
  partner_country               String?
  partner_country_code          String?
  partner_business_street       String?
  partner_business_city         String?
  partner_business_zip          String?
  partner_business_country      String?
  partner_business_country_code String?
  partner_VAT_number            String?
  partner_TAX_number            String?
  partner_TAX_local_number      String?
  partner_phone_prefix          String?
  partner_phone_number          String?
  partner_fax_prefix            String?
  partner_fax_number            String?
  partner_email                 String?
  partner_website               String?
  partner_is_person             Boolean?
  partner_bank                  String?
  partner_account_number        String?
  partner_account_bank_number   String?
  partner_IBAN                  String?
  partner_SWIFT                 String?
  partner_BIC                   String?
  rossum_status                 String?
  rossum_annotation_id          String?
  rossum_annotation_url         String?
  rossum_document_id            String?
  rossum_document_url           String?
  rossum_annotation_json_url    String?
  rossum_annotation_xml_url     String?
  money_s3_url                  String?
  status                        String?
  invoice_state_id              String?
  assigned_user_id              String?
  assigned_account_id           String?
  visibility                    Boolean         @default(true)
  
  // Relations
  invoice_states                invoice_States? @relation(fields: [invoice_state_id], references: [id])
  users                         Users?          @relation(fields: [assigned_user_id], references: [id])
  accounts                      crm_Accounts?   @relation(fields: [assigned_account_id], references: [id])
  
  // Many-to-many through junction tables
  documents                     DocumentInvoices[] @relation(name: "invoice_documents")
  
  @@map("nextcrm_invoices")
}

model invoice_States {
  id                String     @id @default(cuid())
  name              String
  assigned_invoices Invoices[]
  
  @@map("nextcrm_invoice_states")
}

// === SYSTEM MODELS ===
model Employees {
  id     String  @id @default(cuid())
  v      Int
  avatar String
  email  String?
  name   String
  salary Int
  status String
  
  @@map("nextcrm_employees")
}

model MyAccount {
  id                   String  @id @default(cuid())
  v                    Int
  company_name         String
  is_person            Boolean @default(false)
  email                String?
  email_accountant     String?
  phone_prefix         String?
  phone                String?
  mobile_prefix        String?
  mobile               String?
  fax_prefix           String?
  fax                  String?
  website              String?
  street               String?
  city                 String?
  state                String?
  zip                  String?
  country              String?
  country_code         String?
  billing_street       String?
  billing_city         String?
  billing_state        String?
  billing_zip          String?
  billing_country      String?
  billing_country_code String?
  currency             String?
  currency_symbol      String?
  VAT_number           String
  TAX_number           String?
  bank_name            String?
  bank_account         String?
  bank_code            String?
  bank_IBAN            String?
  bank_SWIFT           String?
  
  @@map("nextcrm_my_account")
}

model modulStatus {
  id        String  @id @default(cuid())
  name      String
  isVisible Boolean
  
  @@map("nextcrm_modul_status")
}

model system_Modules_Enabled {
  id       String  @id @default(cuid())
  v        Int
  name     String
  enabled  Boolean
  position Int
  
  @@map("nextcrm_system_modules_enabled")
}

model TodoList {
  id          String @id @default(cuid())
  createdAt   String
  description String
  title       String
  url         String
  user        String
  
  @@map("nextcrm_todo_list")
}

// === AI & INTEGRATIONS ===
model secondBrain_notions {
  id             String @id @default(cuid())
  v              Int
  user           String
  notion_api_key String
  notion_db_id   String
  assigned_user  Users? @relation(fields: [user], references: [id])
  
  @@map("nextcrm_second_brain_notions")
}

model openAi_keys {
  id              String @id @default(cuid())
  v               Int
  user            String
  organization_id String
  api_key         String
  assigned_user   Users? @relation(fields: [user], references: [id])
  
  @@map("nextcrm_openai_keys")
}

model systemServices {
  id              String  @id @default(cuid())
  v               Int
  name            String
  serviceUrl      String?
  serviceId       String?
  serviceKey      String?
  servicePassword String?
  servicePort     String?
  description     String?
  
  @@map("nextcrm_system_services")
}

model gpt_models {
  id          String     @id @default(cuid())
  v           Int
  model       String
  description String?
  status      gptStatus?
  created_on  DateTime?  @default(now())
  
  @@map("nextcrm_gpt_models")
}

// === PLACEHOLDER MODELS ===
model ImageUpload {
  id String @id @default(cuid())
  
  @@map("nextcrm_image_upload")
}
```uk
}

enum gptStatus {
  ACTIVE
  INACTIVE
}

// === JUNCTION TABLES FOR MANY-TO-MANY RELATIONS ===
model UserWatchingBoards {
  id      String @id @default(cuid())
  userId  String
  boardId String
  user    Users  @relation(name: "user_watching_boards", fields: [userId], references: [id], onDelete: Cascade)
  board   Boards @relation(name: "board_watchers", fields: [boardId], references: [id], onDelete: Cascade)
  
  @@unique([userId, boardId])
  @@map("user_watching_boards")
}

model UserWatchingAccounts {
  id        String       @id @default(cuid())
  userId    String
  accountId String
  user      Users        @relation(name: "user_watching_accounts", fields: [userId], references: [id], onDelete: Cascade)
  account   crm_Accounts @relation(name: "account_watchers", fields: [accountId], references: [id], onDelete: Cascade)
  
  @@unique([userId, accountId])
  @@map("user_watching_accounts")
}

model DocumentInvoices {
  id         String    @id @default(cuid())
  documentId String
  invoiceId  String
  document   Documents @relation(name: "document_invoices", fields: [documentId], references: [id], onDelete: Cascade)
  invoice    Invoices  @relation(name: "invoice_documents", fields: [invoiceId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, invoiceId])
  @@map("document_invoices")
}

model DocumentOpportunities {
  id            String            @id @default(cuid())
  documentId    String
  opportunityId String
  document      Documents         @relation(name: "document_opportunities", fields: [documentId], references: [id], onDelete: Cascade)
  opportunity   crm_Opportunities @relation(name: "opportunity_documents", fields: [opportunityId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, opportunityId])
  @@map("document_opportunities")
}

model DocumentContacts {
  id         String       @id @default(cuid())
  documentId String
  contactId  String
  document   Documents    @relation(name: "document_contacts", fields: [documentId], references: [id], onDelete: Cascade)
  contact    crm_Contacts @relation(name: "contact_documents", fields: [contactId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, contactId])
  @@map("document_contacts")
}

model DocumentTasks {
  id         String    @id @default(cuid())
  documentId String
  taskId     String
  document   Documents @relation(name: "document_tasks", fields: [documentId], references: [id], onDelete: Cascade)
  task       Tasks     @relation(name: "task_documents", fields: [taskId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, taskId])
  @@map("document_tasks")
}

model DocumentLeads {
  id         String    @id @default(cuid())
  documentId String
  leadId     String
  document   Documents @relation(name: "document_leads", fields: [documentId], references: [id], onDelete: Cascade)
  lead       crm_Leads @relation(name: "lead_documents", fields: [leadId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, leadId])
  @@map("document_leads")
}

model DocumentAccounts {
  id         String       @id @default(cuid())
  documentId String
  accountId  String
  document   Documents    @relation(name: "document_accounts", fields: [documentId], references: [id], onDelete: Cascade)
  account    crm_Accounts @relation(name: "account_documents", fields: [accountId], references: [id], onDelete: Cascade)
  
  @@unique([documentId, accountId])
  @@map("document_accounts")
}

model ContactOpportunities {
  id            String            @id @default(cuid())
  contactId     String
  opportunityId String
  contact       crm_Contacts      @relation(name: "contact_opportunities", fields: [contactId], references: [id], onDelete: Cascade)
  opportunity   crm_Opportunities @relation(name: "opportunity_contacts", fields: [opportunityId], references: [id], onDelete: Cascade)
  
  @@unique([contactId, opportunityId])
  @@map("contact_opportunities")
}

// === CORE USER MANAGEMENT ===
model Users {
  id                   String                @id @default(cuid())
  v                    Int                   @default(0)
  account_name         String?
  avatar               String?
  email                String                @unique
  is_account_admin     Boolean               @default(false)
  is_admin             Boolean               @default(false)
  created_on           DateTime              @default(now())
  lastLoginAt          DateTime?
  name                 String?
  password             String?
  username             String?
  userStatus           ActiveStatus          @default(PENDING)
  userLanguage         Language              @default(en)
  
  // Relations
  tasksComment         tasksComments[]
  created_by_documents Documents[]           @relation(name: "created_by_user")
  assigned_documents   Documents[]           @relation(name: "assigned_to_user")
  tasks                Tasks[]
  crm_accounts_tasks   crm_Accounts_Tasks[]
  accounts             crm_Accounts[]
  leads                crm_Leads[]
  created_by_user      crm_Opportunities[]   @relation(name: "created_by_user_relation")
  assigned_opportunity crm_Opportunities[]   @relation(name: "assigned_to_user_relation")
  assigned_contacts    crm_Contacts[]        @relation(name: "assigned_contacts")
  crated_contacts      crm_Contacts[]        @relation(name: "created_contacts")
  notion_account       secondBrain_notions[]
  openAi_key           openAi_keys[]
  assigned_invoices    Invoices[]
  assigned_contracts   crm_Contracts[]
  boards               Boards[]              @relation(name: "assigned_user")
  
  // Many-to-many through junction tables
  watching_boards      UserWatchingBoards[]  @relation(name: "user_watching_boards")
  watching_accounts    UserWatchingAccounts[] @relation(name: "user_watching_accounts")
  
  @@map("users")
}

// === CRM ACCOUNTS ===
model crm_Accounts {
  id                   String               @id @default(cuid())
  v                    Int
  createdAt            DateTime             @default(now())
  createdBy            String?
  updatedAt            DateTime?            @updatedAt
  updatedBy            String?
  annual_revenue       String?
  assigned_to          String?
  billing_city         String?
  billing_country      String?
  billing_postal_code  String?
  billing_state        String?
  billing_street       String?
  company_id           String?
  description          String?
  email                String?
  employees            String?
  fax                  String?
  industry             String?
  member_of            String?
  name                 String
  office_phone         String?
  shipping_city        String?
  shipping_country     String?
  shipping_postal_code String?
  shipping_state       String?
  shipping_street      String?
  status               String?              @default("Inactive")
  type                 String?              @default("Customer")
  vat                  String?
  website              String?
  
  // Relations
  invoices             Invoices[]
  contacts             crm_Contacts[]
  leads                crm_Leads[]
  industry_type        crm_Industry_Type?   @relation(fields: [industry], references: [id])
  opportunities        crm_Opportunities[]
  assigned_to_user     Users?               @relation(fields: [assigned_to], references: [id])
  crm_accounts_tasks   crm_Accounts_Tasks[]
  contracts            crm_Contracts[]
  
  // Many-to-many through junction tables
  documents            DocumentAccounts[]   @relation(name: "account_documents")
  watchers             UserWatchingAccounts[] @relation(name: "account_watchers")
  
  @@map("crm_accounts")
}

// === CRM LEADS ===
model crm_Leads {
  id                 String        @id @default(cuid())
  v                  Int           @default(0)
  createdAt          DateTime?     @default(now())
  createdBy          String?
  updatedAt          DateTime?     @updatedAt
  updatedBy          String?
  firstName          String?
  lastName           String
  company            String?
  jobTitle           String?
  email              String?
  phone              String?
  description        String?
  lead_source        String?
  refered_by         String?
  campaign           String?
  status             String?       @default("NEW")
  type               String?       @default("DEMO")
  assigned_to        String?
  accountsIDs        String?
  
  // Relations
  assigned_to_user   Users?        @relation(fields: [assigned_to], references: [id])
  assigned_accounts  crm_Accounts? @relation(fields: [accountsIDs], references: [id])
  
  // Many-to-many through junction tables
  documents          DocumentLeads[] @relation(name: "lead_documents")
  
  @@map("crm_leads")
}

// === CRM OPPORTUNITIES ===
model crm_Opportunities {
  id                   String                          @id @default(cuid())
  v                    Int                             @default(0)
  account              String?
  assigned_to          String?
  budget               Int                             @default(0)
  campaign             String?
  close_date           DateTime?
  contact              String?
  created_by           String?
  createdBy            String?
  created_on           DateTime?                       @default(now())
  createdAt            DateTime                        @default(now())
  last_activity        DateTime?
  updatedAt            DateTime?                       @updatedAt
  updatedBy            String?
  last_activity_by     String?
  currency             String?
  description          String?
  expected_revenue     Int                             @default(0)
  name                 String?
  next_step            String?
  sales_stage          String?
  type                 String?
  status               crm_Opportunity_Status?         @default(ACTIVE)
  
  // Relations
  assigned_type        crm_Opportunities_Type?         @relation(fields: [type], references: [id])
  assigned_sales_stage crm_Opportunities_Sales_Stages? @relation(name: "assinged_sales_stage", fields: [sales_stage], references: [id])
  assigned_to_user     Users?                          @relation(name: "assigned_to_user_relation", fields: [assigned_to], references: [id])
  created_by_user      Users?                          @relation(name: "created_by_user_relation", fields: [created_by], references: [id])
  assigned_account     crm_Accounts?                   @relation(fields: [account], references: [id])
  assigned_campaings   crm_campaigns?                  @relation(fields: [campaign], references: [id])
  
  // Many-to-many through junction tables
  documents            DocumentOpportunities[]         @relation(name: "opportunity_documents")
  contacts             ContactOpportunities[]          @relation(name: "opportunity_contacts")
  
  @@map("crm_opportunities")
}

// === CRM CAMPAIGNS ===
model crm_campaigns {
  id            String              @id @default(cuid())
  v             Int
  name          String
  description   String?
  status        String?
  opportunities crm_Opportunities[]
  
  @@map("crm_campaigns")
}

// === CRM OPPORTUNITY SALES STAGES ===
model crm_Opportunities_Sales_Stages {
  id                                 String              @id @default(cuid())
  v                                  Int
  name                               String
  probability                        Int?
  order                              Int?
  assigned_opportunities_sales_stage crm_Opportunities[] @relation(name: "assinged_sales_stage")
  
  @@map("crm_opportunities_sales_stages")
}

// === CRM OPPORTUNITY TYPES ===
model crm_Opportunities_Type {
  id                     String              @id @default(cuid())
  v                      Int
  name                   String
  order                  Int?
  assigned_opportunities crm_Opportunities[]
  
  @@map("crm_opportunities_type")
}

// === CRM CONTACTS ===
model crm_Contacts {
  id                     String              @id @default(cuid())
  v                      Int                 @default(0)
  account                String?
  assigned_to            String?
  birthday               String?
  created_by             String?
  createdBy              String?
  created_on             DateTime?           @default(now())
  cratedAt               DateTime?           @default(now())
  last_activity          DateTime?           @default(now())
  updatedAt              DateTime?           @updatedAt
  updatedBy              String?
  last_activity_by       String?
  description            String?
  email                  String?
  personal_email         String?
  first_name             String?
  last_name              String
  office_phone           String?
  mobile_phone           String?
  website                String?
  position               String?
  status                 Boolean             @default(true)
  social_twitter         String?
  social_facebook        String?
  social_linkedin        String?
  social_skype           String?
  social_instagram       String?
  social_youtube         String?
  social_tiktok          String?
  type                   String?             @default("Customer")
  tags                   String[]
  notes                  String[]
  accountsIDs            String?
  
  // Relations
  assigned_to_user       Users?              @relation(name: "assigned_contacts", fields: [assigned_to], references: [id])
  crate_by_user          Users?              @relation(name: "created_contacts", fields: [created_by], references: [id])
  assigned_accounts      crm_Accounts?       @relation(fields: [accountsIDs], references: [id])
  
  // Many-to-many through junction tables
  opportunities          ContactOpportunities[] @relation(name: "contact_opportunities")
  documents              DocumentContacts[]     @relation(name: "contact_documents")
  
  @@map("crm_contacts")
}

// === CRM CONTRACTS ===
model crm_Contracts {
  id                  String               @id @default(cuid())
  v                   Int
  title               String
  value               Int
  startDate           DateTime?            @default(now())
  endDate             DateTime?
  renewalReminderDate DateTime?
  customerSignedDate  DateTime?
  companySignedDate   DateTime?
  description         String?
  account             String?
  assigned_to         String?
  createdAt           DateTime?            @default(now())
  createdBy           String?
  updatedAt           DateTime?            @updatedAt
  updatedBy           String?
  status              crm_Contracts_Status @default(NOTSTARTED)
  type                String?
  
  // Relations
  assigned_account    crm_Accounts?        @relation(fields: [account], references: [id])
  assigned_to_user    Users?               @relation(fields: [assigned_to], references: [id])
  
  @@map("crm_contracts")
}

// === INDUSTRY TYPES ===
model crm_Industry_Type {
  id       String         @id @default(cuid())
  v        Int
  name     String
  accounts crm_Accounts[]
  
  @@map("crm_industry_type")
}

// === BOARDS & TASKS ===
model Boards {
  id                String    @id @default(cuid())
  v                 Int
  description       String
  favourite         Boolean?
  favouritePosition Int?
  icon              String?
  position          Int?
  title             String
  user              String
  visibility        String?
  sharedWith        String[]
  createdAt         DateTime? @default(now())
  createdBy         String?
  updatedAt         DateTime? @updatedAt
  updatedBy         String?
  
  // Relations
  assigned_user  Users?   @relation(name: "assigned_user", fields: [user], references: [id])
  
  // Many-to-many through junction tables
  watchers       UserWatchingBoards[] @relation(name: "board_watchers")
  
  @@map("boards")
}

model Tasks {
  id               String          @id @default(cuid())
  v                Int
  content          String?
  createdAt        DateTime?       @default(now())
  createdBy        String?
  updatedAt        DateTime?       @updatedAt
  updatedBy        String?
  dueDateAt        DateTime?       @default(now())
  lastEditedAt     DateTime?       @default(now()) @updatedAt
  position         Int
  priority         String
  section          String?
  tags             Json?
  title            String
  likes            Int?            @default(0)
  user             String?
  taskStatus       taskStatus?     @default(ACTIVE)
  
  // Relations
  comments         tasksComments[]
  assigned_user    Users?          @relation(fields: [user], references: [id])
  assigned_section Sections?       @relation(fields: [section], references: [id])
  
  // Many-to-many through junction tables
  documents        DocumentTasks[] @relation(name: "task_documents")
  
  @@map("tasks")
}

model crm_Accounts_Tasks {
  id            String          @id @default(cuid())
  v             Int
  content       String?
  createdAt     DateTime?       @default(now())
  createdBy     String?
  updatedAt     DateTime?       @updatedAt
  updatedBy     String?
  dueDateAt     DateTime?       @default(now())
  priority      String
  tags          Json?
  title         String
  likes         Int?            @default(0)
  user          String?
  account       String?
  taskStatus    taskStatus?     @default(ACTIVE)
  
  // Relations
  comments      tasksComments[]
  documents     Documents[]
  assigned_user Users?          @relation(fields: [user], references: [id])
  crm_accounts  crm_Accounts?   @relation(fields: [account], references: [id])
  
  @@map("crm_accounts_tasks")
}

model tasksComments {
  id                             String              @id @default(cuid())
  v                              Int
  comment                        String
  createdAt                      DateTime            @default(now())
  task                           String
  user                           String
  assigned_crm_account_task      String?
  
  // Relations
  assigned_crm_account_task_task crm_Accounts_Tasks? @relation(fields: [assigned_crm_account_task], references: [id])
  assigned_task                  Tasks?              @relation(fields: [task], references: [id], onDelete: Cascade)
  assigned_user                  Users?              @relation(fields: [user], references: [id])
  
  @@map("tasks_comments")
}

model Sections {
  id       String  @id @default(cuid())
  v        Int
  board    String
  title    String
  position Int?
  tasks    Tasks[]
  
  @@map("sections")
}

// === DOCUMENTS ===
model Documents {
  id                     String              @id @default(cuid())
  v                      Int?
  date_created           DateTime?           @default(now())
  createdAt              DateTime?           @default(now())
  last_updated           DateTime?           @updatedAt
  updatedAt              DateTime?           @updatedAt
  document_name          String
  created_by_user        String?
  createdBy              String?
  description            String?
  document_type          String?
  favourite              Boolean?
  document_file_mimeType String
  document_file_url      String
  status                 String?
  visibility             String?
  tags                   Json?
  key                    String?
  size                   Int?
  assigned_user          String?
  connected_documents    String[]
  document_system_type   DocumentSystemType? @default(OTHER)
  
  // Relations
  created_by             Users?              @relation(name: "created_by_user", fields: [created_by_user], references: [id])
  assigned_to_user       Users?              @relation(name: "assigned_to_user", fields: [assigned_user], references: [id])
  documents_type         Documents_Types?    @relation(fields: [document_type], references: [id])
  crm_accounts_tasks     crm_Accounts_Tasks[]
  
  // Many-to-many through junction tables
  invoices               DocumentInvoices[]    @relation(name: "document_invoices")
  opportunities          DocumentOpportunities[] @relation(name: "document_opportunities")
  contacts               DocumentContacts[]    @relation(name: "document_contacts")
  tasks                  DocumentTasks[]       @relation(name: "document_tasks")
  leads                  DocumentLeads[]       @relation(name: "document_leads")
  accounts               DocumentAccounts[]    @relation(name: "document_accounts")
  
  @@map("documents")
}

model Documents_Types {
  id                 String      @id @default(cuid())
  v                  Int
  name               String
  assigned_documents Documents[]
  
  @@map("documents_types")
}

// === INVOICES ===
model Invoices {
  id                            String          @id @default(cuid())
  v                             Int?
  date_created                  DateTime        @default(now())
  last_updated                  DateTime        @updatedAt
  last_updated_by               String?
  date_received                 DateTime?       @default(now())
  date_of_case                  DateTime?
  date_tax                      DateTime?
  date_due                      DateTime?
  description                   String?
  document_type                 String?
  favorite                      Boolean?        @default(false)
  variable_symbol               String?
  constant_symbol               String?
  specific_symbol               String?
  order_number                  String?
  internal_number               String?
  invoice_number                String?
  invoice_amount                String?
  invoice_file_mimeType         String
  invoice_file_url              String
  invoice_items                 Json?
  invoice_type                  String?
  invoice_currency              String?
  invoice_language              String?
  partner                       String?
  partner_street                String?
  partner_city                  String?
  partner_zip                   String?
  partner_country               String?
  partner_country_code          String?
  partner_business_street       String?
  partner_business_city         String?
  partner_business_zip          String?
  partner_business_country      String?
  partner_business_country_code String?
  partner_VAT_number            String?
  partner_TAX_number            String?
  partner_TAX_local_number      String?
  partner_phone_prefix          String?
  partner_phone_number          String?
  partner_fax_prefix            String?
  partner_fax_number            String?
  partner_email                 String?
  partner_website               String?
  partner_is_person             Boolean?
  partner_bank                  String?
  partner_account_number        String?
  partner_account_bank_number   String?
  partner_IBAN                  String?
  partner_SWIFT                 String?
  partner_BIC                   String?
  rossum_status                 String?
  rossum_annotation_id          String?
  rossum_annotation_url         String?
  rossum_document_id            String?
  rossum_document_url           String?
  rossum_annotation_json_url    String?
  rossum_annotation_xml_url     String?
  money_s3_url                  String?
  status                        String?
  invoice_state_id              String?
  assigned_user_id              String?
  assigned_account_id           String?
  visibility                    Boolean         @default(true)
  
  // Relations
  invoice_states                invoice_States? @relation(fields: [invoice_state_id], references: [id])
  users                         Users?          @relation(fields: [assigned_user_id], references: [id])
  accounts                      crm_Accounts?   @relation(fields: [assigned_account_id], references: [id])
  
  // Many-to-many through junction tables
  documents                     DocumentInvoices[] @relation(name: "invoice_documents")
  
  @@map("invoices")
}

model invoice_States {
  id                String     @id @default(cuid())
  name              String
  assigned_invoices Invoices[]
  
  @@map("invoice_states")
}

// === SYSTEM MODELS ===
model Employees {
  id     String  @id @default(cuid())
  v      Int
  avatar String
  email  String?
  name   String
  salary Int
  status String
  
  @@map("employees")
}

model MyAccount {
  id                   String  @id @default(cuid())
  v                    Int
  company_name         String
  is_person            Boolean @default(false)
  email                String?
  email_accountant     String?
  phone_prefix         String?
  phone                String?
  mobile_prefix        String?
  mobile               String?
  fax_prefix           String?
  fax                  String?
  website              String?
  street               String?
  city                 String?
  state                String?
  zip                  String?
  country              String?
  country_code         String?
  billing_street       String?
  billing_city         String?
  billing_state        String?
  billing_zip          String?
  billing_country      String?
  billing_country_code String?
  currency             String?
  currency_symbol      String?
  VAT_number           String
  TAX_number           String?
  bank_name            String?
  bank_account         String?
  bank_code            String?
  bank_IBAN            String?
  bank_SWIFT           String?
  
  @@map("my_account")
}

model modulStatus {
  id        String  @id @default(cuid())
  name      String
  isVisible Boolean
  
  @@map("modul_status")
}

model system_Modules_Enabled {
  id       String  @id @default(cuid())
  v        Int
  name     String
  enabled  Boolean
  position Int
  
  @@map("system_modules_enabled")
}

model TodoList {
  id          String @id @default(cuid())
  createdAt   String
  description String
  title       String
  url         String
  user        String
  
  @@map("todo_list")
}

// === AI & INTEGRATIONS ===
model secondBrain_notions {
  id             String @id @default(cuid())
  v              Int
  user           String
  notion_api_key String
  notion_db_id   String
  assigned_user  Users? @relation(fields: [user], references: [id])
  
  @@map("second_brain_notions")
}

model openAi_keys {
  id              String @id @default(cuid())
  v               Int
  user            String
  organization_id String
  api_key         String
  assigned_user   Users? @relation(fields: [user], references: [id])
  
  @@map("openai_keys")
}

model systemServices {
  id              String  @id @default(cuid())
  v               Int
  name            String
  serviceUrl      String?
  serviceId       String?
  serviceKey      String?
  servicePassword String?
  servicePort     String?
  description     String?
  
  @@map("system_services")
}

model gpt_models {
  id          String     @id @default(cuid())
  v           Int
  model       String
  description String?
  status      gptStatus?
  created_on  DateTime?  @default(now())
  
  @@map("gpt_models")
}

// === PLACEHOLDER MODELS ===
model ImageUpload {
  id String @id @default(cuid())
  
  @@map("image_upload")
}
```

## **Impact of Table Renaming**

### **✅ What WON'T Change:**
- **Your code logic** - Prisma models keep the same names (`Users`, `crm_Accounts`, etc.)
- **API routes** - No changes needed to your API endpoints
- **Components** - Your React components work exactly the same
- **Types** - All TypeScript types remain identical

### **🔄 What Changes:**
- **Database table names** - Now prefixed with `nextcrm_`
- **No conflicts** - Your tables won't clash with existing ones

## **Example: How It Works**

Your code stays the same:
```typescript
// This code doesn't change at all!
const contacts = await prisma.crm_Contacts.findMany({
  include: {
    assigned_accounts: true
  }
})
```

But in the database, the table is actually called `nextcrm_crm_contacts`.

## **Now Try the Migration**

With the renamed schema, run:

```bash
npx prisma db push
```

This should work without conflicts since all your tables now have unique names!

## **After Successful Push**

1. **Verify it worked:**
```bash
npx prisma generate
```

2. **Check your tables in Supabase:**
   - Go to Supabase Dashboard → Table Editor
   - You should see all your `nextcrm_` prefixed tables

3. **Test a simple query:**
```bash
npx prisma studio
```

## **If You Still Get Conflicts**

If you're still seeing the old tables, make sure you're using the correct database URL. Check your `.env` file:

```bash
# Make sure you're pointing to the NEW database
DATABASE_URL="postgresql://postgres:[password]@db.YOUR-NEW-PROJECT-REF.supabase.co:5432/postgres"
```

The renamed tables approach is the cleanest solution - your app code stays identical, but your database tables won't conflict with anything existing.

Try `npx prisma db push` now with the renamed schema!

### 3.1 Create Supabase Client

Create `lib/supabase.ts`:

```typescript
import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client
export function createClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}

// Server-side Supabase client
export function createServerSupabaseClient() {
  const cookieStore = cookies()
  
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value
      },
    },
  })
}
```

### 3.2 Update Prisma Client

Update `lib/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

## Phase 4: API Route Migration

Based on the new junction table structure and the NextCRM schema, here are the API route files that will need modifications:
Files That Need Updates
1. High Priority - Core CRM Routes (Must Update)
app/api/crm/contacts/route.ts ✅ (Already updated)
app/api/crm/accounts/route.ts 
app/api/crm/leads/route.ts
app/api/crm/opportunities/route.ts
app/api/crm/invoices/route.ts
2. Medium Priority - Document & Task Routes
app/api/documents/route.ts
app/api/tasks/route.ts
app/api/crm/accounts-tasks/route.ts
3. Lower Priority - System Routes
app/api/boards/route.ts
app/api/users/route.ts (for watching relationships)

### 4.1 Update API Routes for Junction Tables

Since we converted many-to-many relations to junction tables, update your API routes:

**Example: `app/api/contacts/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contacts = await prisma.crm_Contacts.findMany({
      where: {
        assigned_to_user: {
          email: session.user.email
        }
      },
      include: {
        assigned_accounts: true,
        // Include documents through junction table
        documents: {
          include: {
            document: true
          }
        },
        // Include opportunities through junction table
        opportunities: {
          include: {
            opportunity: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(contacts)
  } catch (error) {
    console.error('Error fetching contacts:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { first_name, last_name, email, office_phone, position, accountsIDs, opportunityIds } = body

    const user = await prisma.users.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Create contact with junction table relations
    const contact = await prisma.crm_Contacts.create({
      data: {
        first_name,
        last_name,
        email,
        office_phone,
        position,
        assigned_to: user.id,
        accountsIDs: accountsIDs || null,
        // Create opportunity relations through junction table
        opportunities: {
          create: opportunityIds?.map((opportunityId: string) => ({
            opportunityId
          })) || []
        }
      },
      include: {
        assigned_accounts: true,
        opportunities: {
          include: {
            opportunity: true
          }
        }
      }
    })

    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    console.error('Error creating contact:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

### 4.2 Update Document Relations API

**Example: `app/api/documents/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      document_name, 
      document_file_url, 
      document_file_mimeType,
      contactIds = [],
      opportunityIds = [],
      accountIds = [],
      taskIds = [],
      leadIds = [],
      invoiceIds = []
    } = body

    const document = await prisma.documents.create({
      data: {
        document_name,
        document_file_url,
        document_file_mimeType,
        // Create many-to-many relations through junction tables
        contacts: {
          create: contactIds.map((contactId: string) => ({
            contactId
          }))
        },
        opportunities: {
          create: opportunityIds.map((opportunityId: string) => ({
            opportunityId
          }))
        },
        accounts: {
          create: accountIds.map((accountId: string) => ({
            accountId
          }))
        },
        tasks: {
          create: taskIds.map((taskId: string) => ({
            taskId
          }))
        },
        leads: {
          create: leadIds.map((leadId: string) => ({
            leadId
          }))
        },
        invoices: {
          create: invoiceIds.map((invoiceId: string) => ({
            invoiceId
          }))
        }
      },
      include: {
        contacts: {
          include: {
            contact: true
          }
        },
        opportunities: {
          include: {
            opportunity: true
          }
        }
      }
    })

    return NextResponse.json(document, { status: 201 })
  } catch (error) {
    console.error('Error creating document:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
```

## Phase 5: Component Updates for Junction Tables

### 5.1 Update Data Fetching Components

**Example: Contact List Component with Junction Tables**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { crm_Contacts, crm_Accounts } from '@prisma/client'

type ContactWithRelations = crm_Contacts & {
  assigned_accounts: crm_Accounts | null
  documents: Array<{
    document: {
      id: string
      document_name: string
      document_file_url: string
    }
  }>
  opportunities: Array<{
    opportunity: {
      id: string
      name: string
      status: string
    }
  }>
}

export default function ContactsList() {
  const [contacts, setContacts] = useState<ContactWithRelations[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchContacts()
  }, [])

  const fetchContacts = async () => {
    try {
      const response = await fetch('/api/contacts')
      if (response.ok) {
        const data = await response.json()
        setContacts(data)
      }
    } catch (error) {
      console.error('Error fetching contacts:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div>Loading contacts...</div>
  }

  return (
    <div className="grid gap-4">
      {contacts.map((contact) => (
        <div key={contact.id} className="p-4 border rounded-lg">
          <h3 className="font-semibold">
            {contact.first_name} {contact.last_name}
          </h3>
          {contact.email && <p className="text-gray-600">{contact.email}</p>}
          {contact.assigned_accounts && (
            <p className="text-sm text-gray-500">{contact.assigned_accounts.name}</p>
          )}
          
          {/* Show related documents */}
          {contact.documents.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium">Documents:</p>
              {contact.documents.map((doc) => (
                <span key={doc.document.id} className="text-xs bg-blue-100 px-2 py-1 rounded mr-1">
                  {doc.document.document_name}
                </span>
              ))}
            </div>
          )}
          
          {/* Show related opportunities */}
          {contact.opportunities.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium">Opportunities:</p>
              {contact.opportunities.map((opp) => (
                <span key={opp.opportunity.id} className="text-xs bg-green-100 px-2 py-1 rounded mr-1">
                  {opp.opportunity.name}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

## Phase 6: Real-time Features (Optional)

### 6.1 Add Supabase Real-time for CRM Updates

```typescript
'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { crm_Contacts } from '@prisma/client'

export default function RealTimeContacts() {
  const [contacts, setContacts] = useState<crm_Contacts[]>([])
  const supabase = createClient()

  useEffect(() => {
    // Initial fetch
    fetchContacts()

    // Subscribe to real-time changes on contacts table
    const channel = supabase
      .channel('crm-contacts-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'crm_contacts' },
        (payload) => {
          console.log('Contact updated:', payload)
          fetchContacts() // Refetch contacts
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const fetchContacts = async () => {
    const response = await fetch('/api/contacts')
    if (response.ok) {
      const data = await response.json()
      setContacts(data)
    }
  }

  return (
    <div>
      {/* Your contacts UI with real-time updates */}
    </div>
  )
}
```

## Phase 7: Migration Checklist

### Before Migration
- [ ] Backup your MongoDB data
- [ ] Set up Supabase project
- [ ] Configure environment variables
- [ ] Test database connection

### During Migration
- [ ] Update Prisma schema for PostgreSQL with junction tables
- [ ] Run database migrations
- [ ] Update all API routes to handle junction tables
- [ ] Update authentication configuration
- [ ] Test core functionality

### After Migration
- [ ] Migrate existing data (if needed) - see data migration scripts below
- [ ] Update deployment configuration
- [ ] Test all features thoroughly
- [ ] Update documentation
- [ ] Monitor for issues

## Phase 8: Data Migration Scripts

### 8.1 MongoDB to PostgreSQL Data Migration

Create `scripts/migrate-data.ts`:

```typescript
import { PrismaClient as PrismaMongo } from '@prisma/client-mongo'
import { PrismaClient as PrismaPostgres } from '@prisma/client'

const mongoClient = new PrismaMongo({
  datasources: {
    db: {
      url: 'your-mongodb-connection-string'
    }
  }
})

const postgresClient = new PrismaPostgres()

async function migrateUsers() {
  const mongoUsers = await mongoClient.users.findMany()
  
  for (const user of mongoUsers) {
    await postgresClient.users.create({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        is_account_admin: user.is_account_admin,
        is_admin: user.is_admin,
        created_on: user.created_on,
        lastLoginAt: user.lastLoginAt,
        password: user.password,
        username: user.username,
        userStatus: user.userStatus,
        userLanguage: user.userLanguage
      }
    })
  }
}

async function migrateContactsWithJunctions() {
  const mongoContacts = await mongoClient.crm_Contacts.findMany({
    include: {
      assigned_documents: true,
      assigned_opportunities: true
    }
  })
  
  for (const contact of mongoContacts) {
    // Create contact first
    const newContact = await postgresClient.crm_Contacts.create({
      data: {
        id: contact.id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
        office_phone: contact.office_phone,
        position: contact.position,
        // ... other fields
      }
    })
    
    // Create document relations through junction table
    for (const doc of contact.assigned_documents) {
      await postgresClient.documentContacts.create({
        data: {
          contactId: newContact.id,
          documentId: doc.id
        }
      })
    }
    
    // Create opportunity relations through junction table
    for (const opp of contact.assigned_opportunities) {
      await postgresClient.contactOpportunities.create({
        data: {
          contactId: newContact.id,
          opportunityId: opp.id
        }
      })
    }
  }
}

// Run migration
async function main() {
  try {
    console.log('Starting data migration...')
    await migrateUsers()
    await migrateContactsWithJunctions()
    // Add other migration functions...
    console.log('Migration completed successfully!')
  } catch (error) {
    console.error('Migration failed:', error)
  } finally {
    await mongoClient.$disconnect()
    await postgresClient.$disconnect()
  }
}

main()
```

## Key Differences to Remember

1. **Junction Tables**: Many-to-many relations now use explicit junction tables instead of embedded arrays
2. **ID Fields**: Changed from MongoDB ObjectId to UUIDs (`cuid()`)
3. **Relations**: More explicit foreign key relationships
4. **Queries**: Include junction table data when fetching related records
5. **Real-time**: Built-in PostgreSQL changes subscription with Supabase

## Additional Benefits

- **Better Performance**: PostgreSQL with proper indexing and connection pooling
- **ACID Compliance**: Full transaction support for complex CRM operations
- **Rich Ecosystem**: More tools and extensions available
- **Real-time**: Built-in real-time subscriptions with Supabase
- **Junction Table Flexibility**: More control over many-to-many relationships

This migration transforms your NextCRM from MongoDB to a robust PostgreSQL setup while maintaining all CRM functionality with improved relationships and performance.
