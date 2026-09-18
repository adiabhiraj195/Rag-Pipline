# RAG Pipeline & Conversational AI API Documentation

Comprehensive API documentation for the RAG Pipeline platform, covering User Authentication, Persistent Conversational AI, Knowledge Base Document Ingestion, and Stateless Retrieval.

---

## 📌 Base URLs

The server listens on `PORT` (default `8000`).

- **Base URL**: `http://localhost:8000`
- **Prefixes**:
  - Auth: `/auth` (or `/api/auth`)
  - Conversations: `/conversations` (or `/api/conversations`)
  - RAG / Ingestion: `/rag` (or root `/`)

---

## 🔐 Authentication Scheme

Endpoints marked with **🔒 Protected** require a valid JSON Web Token (JWT) in the HTTP `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

Tokens are obtained via `/auth/register` or `/auth/login` and are valid for **7 days** by default.

---

## 📑 Table of Contents

1. [Authentication & Organisation Endpoints](#1-authentication--organisation-endpoints)
   - [User Roles & Approval Architecture](#11-user-roles--approval-architecture)
   - [List Public Organisations](#12-list-public-organisations) (`GET /auth/organisations`)
   - [Unified Registration](#13-unified-registration) (`POST /auth/register`)
   - [Register Admin with Organisation](#14-register-admin-with-organisation) (`POST /auth/register/admin`)
   - [Register Support Agent](#15-register-support-agent) (`POST /auth/register/support-agent`)
   - [Register Customer](#16-register-customer) (`POST /auth/register/customer`)
   - [Login User](#17-login-user) (`POST /auth/login`)
   - [Get Current User Profile](#18-get-current-user-profile) (`GET /auth/me`)
   - [List Support Agents (Admin)](#19-list-support-agents-admin) (`GET /auth/organisation/support-agents`)
   - [Approve Support Agent (Admin)](#110-approve-support-agent-admin) (`POST /auth/organisation/support-agents/:id/approve`)
   - [Reject Support Agent (Admin)](#111-reject-support-agent-admin) (`POST /auth/organisation/support-agents/:id/reject`)
2. [Conversation & Messaging Endpoints](#2-conversation--messaging-endpoints)
   - [Create Conversation](#21-create-conversation) (`POST /conversations`)
   - [List User Conversations](#22-list-user-conversations) (`GET /conversations`)
   - [Get Conversation by ID](#23-get-conversation-by-id) (`GET /conversations/:id`)
   - [Send Message to Conversation](#24-send-message-to-conversation) (`POST /conversations/:id/messages`)
   - [Delete Conversation](#25-delete-conversation) (`DELETE /conversations/:id`)
3. [Knowledge Base Document Ingestion Endpoints](#3-knowledge-base-document-ingestion-endpoints)
   - [Generate Presigned Upload URL](#31-generate-presigned-upload-url) (`POST /rag/upload-url`)
   - [Queue Document Ingestion](#32-queue-document-ingestion) (`POST /rag/injestTXT`)
   - [Check Ingestion Job Status](#33-check-ingestion-job-status) (`GET /rag/job-status/:jobId`)
4. [Stateless Chat & Retrieval Endpoint](#4-stateless-chat--retrieval-endpoint)
   - [Stateless Hybrid RAG Query](#41-stateless-hybrid-rag-query) (`POST /rag/chat`)
5. [System Health](#5-system-health)
   - [Health Check](#51-health-check) (`GET /health`)

---

## 1. Authentication & Organisation Endpoints

Routes: `/auth/*` and `/api/auth/*`

### 1.1 User Roles & Approval Architecture

The system supports a multi-tenant hierarchy with three distinct roles:

| Role | Initial Status | Verified? | Description & Permissions |
| :--- | :--- | :--- | :--- |
| **`Admin`** | `ACTIVE` | `true` | Organisation administrator. Created together with their Organisation. Can manage organisation settings, view support agents, and **approve or reject** pending Support Agents. Has full task permissions. |
| **`Customer`** | `ACTIVE` | `true` | End-user customer of a specified organisation. Created as active immediately. Can initiate and manage conversations, send messages, and execute RAG retrieval. |
| **`Support Agent`** | `PENDING_APPROVAL` | `false` | Member of the support team for an organisation. **Has no permission to perform tasks until approved by an organisation Admin.** Attempting to create/manage conversations or perform tasks returns `403 Forbidden`. |

---

### 1.2 List Public Organisations
Public directory of organisations available for user registration.

- **Method**: `GET`
- **Path**: `/auth/organisations` (alias: `/api/auth/organisations`)
- **Access**: 🌐 Public
- **Headers**: None required

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "organisations": [
      {
        "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
        "name": "Acme Technologies",
        "type": "Technology",
        "createdAt": "2026-09-17T18:00:00.000Z",
        "_count": { "users": 12 }
      }
    ]
  }
}
```

---

### 1.3 Unified Registration
Unified registration endpoint supporting all three roles (`Admin`, `Customer`, `Support Agent`).

- **Method**: `POST`
- **Path**: `/auth/register` (alias: `/api/auth/register`)
- **Access**: 🌐 Public
- **Headers**:
  - `Content-Type: application/json`

#### Request Body Schema
| Field | Type | Required For | Description |
| :--- | :--- | :--- | :--- |
| `email` | `string` | **All** | Valid email address. |
| `password` | `string` | **All** | Account password (min 6 characters). |
| `name` | `string` | Optional | User's full or display name. |
| `role` | `string` | **All** | One of: `"Admin"`, `"Customer"`, `"Support Agent"`. |
| `organisationName` | `string` | **Admin** (or Customer / Support Agent) | Name of organisation. Creates new for Admin; matches existing for Customer / Agent. |
| `organisationType` | `string` | Optional (Admin) | Sector/type, e.g. `"Enterprise"`, `"Startup"`, `"Healthcare"`. |
| `organisationConfig` | `object` | Optional (Admin) | Flexible JSON settings/configuration for the organisation. |
| `organisationId` | `string` (UUID) | **Customer / Agent** | ID of the organisation to join (alternative to `organisationName`). |

#### Example 1: Admin Registration (Creates Organisation)
```json
{
  "email": "admin@acme.com",
  "password": "SecurePassword123!",
  "name": "Alice Admin",
  "role": "Admin",
  "organisationName": "Acme Technologies",
  "organisationType": "Technology",
  "organisationConfig": {
    "domain": "acme.com",
    "tier": "Enterprise"
  }
}
```

**Response (`201 Created`)**:
```json
{
  "success": true,
  "message": "Admin user and organisation registered successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "email": "admin@acme.com",
      "name": "Alice Admin",
      "role": "Admin",
      "status": "ACTIVE",
      "isVerified": true,
      "createdAt": "2026-09-17T20:00:00.000Z"
    },
    "organisation": {
      "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "name": "Acme Technologies",
      "type": "Technology",
      "config": { "domain": "acme.com", "tier": "Enterprise" },
      "createdAt": "2026-09-17T20:00:00.000Z"
    }
  }
}
```

#### Example 2: Support Agent Registration (Pending Approval)
```json
{
  "email": "agent@acme.com",
  "password": "SecurePassword123!",
  "name": "Sam Agent",
  "role": "Support Agent",
  "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456"
}
```

**Response (`201 Created`)**:
```json
{
  "success": true,
  "message": "Support Agent registration submitted. Your account is pending approval by your organisation admin before you can perform any tasks.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "b2c3d4e5-0000-0000-0000-000000000002",
      "email": "agent@acme.com",
      "name": "Sam Agent",
      "role": "Support Agent",
      "status": "PENDING_APPROVAL",
      "isVerified": false,
      "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "createdAt": "2026-09-17T20:05:00.000Z"
    },
    "organisation": {
      "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "name": "Acme Technologies",
      "type": "Technology"
    }
  }
}
```

#### Example 3: Customer Registration (Active)
```json
{
  "email": "customer@client.com",
  "password": "SecurePassword123!",
  "name": "Cathy Customer",
  "role": "Customer",
  "organisationName": "Acme Technologies"
}
```

**Response (`201 Created`)**:
```json
{
  "success": true,
  "message": "Customer registered successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "c3d4e5f6-0000-0000-0000-000000000003",
      "email": "customer@client.com",
      "name": "Cathy Customer",
      "role": "Customer",
      "status": "ACTIVE",
      "isVerified": true,
      "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "createdAt": "2026-09-17T20:10:00.000Z"
    },
    "organisation": {
      "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "name": "Acme Technologies",
      "type": "Technology"
    }
  }
}
```

---

### 1.4 Register Admin with Organisation
Dedicated shortcut endpoint for Admin onboarding.

- **Method**: `POST`
- **Path**: `/auth/register/admin` (alias: `/api/auth/register/admin`)
- **Access**: 🌐 Public
- Automatically assigns `role: "Admin"`. Accepts `organisationName`, `organisationType`, `organisationConfig`.

---

### 1.5 Register Support Agent
Dedicated shortcut endpoint for Support Agent onboarding.

- **Method**: `POST`
- **Path**: `/auth/register/support-agent` (alias: `/api/auth/register/support-agent`)
- **Access**: 🌐 Public
- Automatically assigns `role: "Support Agent"` with status `PENDING_APPROVAL`. Requires `organisationId` or `organisationName`.

---

### 1.6 Register Customer
Dedicated shortcut endpoint for Customer onboarding.

- **Method**: `POST`
- **Path**: `/auth/register/customer` (alias: `/api/auth/register/customer`)
- **Access**: 🌐 Public
- Automatically assigns `role: "Customer"` with status `ACTIVE`. Requires `organisationId` or `organisationName`.

---

### 1.7 Login User
Authenticate existing credentials and receive a JWT token.

- **Method**: `POST`
- **Path**: `/auth/login` (alias: `/api/auth/login`)
- **Access**: 🌐 Public
- **Headers**:
  - `Content-Type: application/json`

#### Request Body
```json
{
  "email": "admin@acme.com",
  "password": "SecurePassword123!"
}
```

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Login successful.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "email": "admin@acme.com",
      "name": "Alice Admin",
      "role": "Admin",
      "status": "ACTIVE",
      "isVerified": true,
      "createdAt": "2026-09-17T20:00:00.000Z"
    },
    "organisation": {
      "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "name": "Acme Technologies",
      "type": "Technology"
    }
  }
}
```
- **`403 Forbidden`**: Returned if the user account status is `REJECTED`.
- **`401 Unauthorized`**: Invalid email or password.

---

### 1.8 Get Current User Profile
Fetch account and organisation details of the authenticated user.

- **Method**: `GET`
- **Path**: `/auth/me` (alias: `/api/auth/me`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "a1b2c3d4-0000-0000-0000-000000000001",
      "email": "admin@acme.com",
      "name": "Alice Admin",
      "role": "Admin",
      "status": "ACTIVE",
      "isVerified": true,
      "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "createdAt": "2026-09-17T20:00:00.000Z",
      "updatedAt": "2026-09-17T20:00:00.000Z",
      "organisation": {
        "id": "7b8e90a1-4321-4fbb-9101-abcdef123456",
        "name": "Acme Technologies",
        "type": "Technology",
        "config": { "domain": "acme.com" },
        "createdAt": "2026-09-17T20:00:00.000Z"
      }
    }
  }
}
```

---

### 1.9 List Support Agents (Admin)
List support agents belonging to the authenticated Admin's organisation.

- **Method**: `GET`
- **Path**: `/auth/organisation/support-agents` (alias: `/api/auth/organisation/support-agents`)
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Authorization: Bearer <admin_token>`
- **Query Parameters**:
  - `status` (`string`, optional): Filter agents by status. E.g. `PENDING_APPROVAL`, `ACTIVE`, `REJECTED`, or `all`.

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "agents": [
      {
        "id": "b2c3d4e5-0000-0000-0000-000000000002",
        "email": "agent@acme.com",
        "name": "Sam Agent",
        "role": "Support Agent",
        "status": "PENDING_APPROVAL",
        "isVerified": false,
        "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
        "createdAt": "2026-09-17T20:05:00.000Z",
        "updatedAt": "2026-09-17T20:05:00.000Z"
      }
    ]
  }
}
```
- **`403 Forbidden`**: User is not an active Admin.

---

### 1.10 Approve Support Agent (Admin)
Approve a pending Support Agent belonging to the authenticated Admin's organisation.

- **Method**: `POST`
- **Path**: `/auth/organisation/support-agents/:id/approve`
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Authorization: Bearer <admin_token>`

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Support agent approved successfully. The agent can now perform tasks.",
  "data": {
    "agent": {
      "id": "b2c3d4e5-0000-0000-0000-000000000002",
      "email": "agent@acme.com",
      "name": "Sam Agent",
      "role": "Support Agent",
      "status": "ACTIVE",
      "isVerified": true,
      "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "updatedAt": "2026-09-17T20:15:00.000Z"
    }
  }
}
```
- **`403 Forbidden`**: Caller is not an Admin or attempts to approve an agent belonging to a different organisation.
- **`404 Not Found`**: Support agent does not exist.

---

### 1.11 Reject Support Agent (Admin)
Reject a pending Support Agent registration.

- **Method**: `POST`
- **Path**: `/auth/organisation/support-agents/:id/reject`
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Authorization: Bearer <admin_token>`

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Support agent rejected.",
  "data": {
    "agent": {
      "id": "b2c3d4e5-0000-0000-0000-000000000002",
      "email": "agent@acme.com",
      "role": "Support Agent",
      "status": "REJECTED",
      "isVerified": false,
      "organisationId": "7b8e90a1-4321-4fbb-9101-abcdef123456",
      "updatedAt": "2026-09-17T20:16:00.000Z"
    }
  }
}
```
- **`403 Forbidden`**: Caller is not an Admin or attempts to manage an agent belonging to another organisation.

## 2. Conversation & Messaging Endpoints

Routes: `/conversations/*` and `/api/conversations/*`

All endpoints in this group are **🔒 Protected** and scoped to the authenticated user.

---

### 2.1 Create Conversation
Initiate a new conversation thread for the logged-in user.

- **Method**: `POST`
- **Path**: `/conversations` (alias: `/api/conversations`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | No | Initial title for the conversation (defaults to `"New Conversation"`). |

```json
{
  "title": "Quarterly Financial Analysis"
}
```

#### Responses
- **`201 Created`**:
```json
{
  "success": true,
  "message": "Conversation created successfully.",
  "data": {
    "conversation": {
      "id": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "title": "Quarterly Financial Analysis",
      "createdAt": "2026-09-17T18:25:00.000Z",
      "updatedAt": "2026-09-17T18:25:00.000Z"
    }
  }
}
```
- **`401 Unauthorized`**: Missing or invalid JWT.

---

### 2.2 List User Conversations
Retrieve all conversations owned by the authenticated user, ordered by most recently updated first.

- **Method**: `GET`
- **Path**: `/conversations` (alias: `/api/conversations`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`

#### Request Parameters
None.

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
        "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
        "title": "Quarterly Financial Analysis",
        "createdAt": "2026-09-17T18:25:00.000Z",
        "updatedAt": "2026-09-17T18:27:30.000Z",
        "_count": {
          "messages": 4
        }
      }
    ]
  }
}
```
- **`401 Unauthorized`**: Missing or invalid JWT.

---

### 2.3 Get Conversation by ID
Retrieve a specific conversation along with its full chronological message history.

- **Method**: `GET`
- **Path**: `/conversations/:id` (alias: `/api/conversations/:id`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | **Yes** | Unique identifier of the conversation. |

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "title": "Quarterly Financial Analysis",
      "createdAt": "2026-09-17T18:25:00.000Z",
      "updatedAt": "2026-09-17T18:27:30.000Z",
      "messages": [
        {
          "id": "848da075-802c-4ec7-b087-0b1a0e1c6b12",
          "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
          "role": "user",
          "content": "What was the total revenue in Q3?",
          "metadata": null,
          "createdAt": "2026-09-17T18:25:30.000Z"
        },
        {
          "id": "6e4df9d1-cbf7-4c40-a3ce-8c9df4ec2b65",
          "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
          "role": "assistant",
          "content": "Based on the Q3 report, total revenue was $14.2M.",
          "metadata": {
            "sources": [
              {
                "index": 1,
                "chunkId": "chunk:doc123:v1:0",
                "filename": "q3_report.txt",
                "content": "Total revenue for Q3 amounted to $14.2M...",
                "relevanceScore": 0.92
              }
            ],
            "pipelineStats": {
              "semanticRetrieved": 10,
              "lexicalRetrieved": 4,
              "rrfCandidates": 12,
              "rerankedChunks": 5,
              "passedThresholdChunks": 1,
              "scoreThreshold": 0.6,
              "durationMs": 1450
            },
            "originalQuery": "What was the total revenue in Q3?",
            "rewrittenQuery": "What was the total revenue in Q3?",
            "queryRewriteStatus": "clear"
          },
          "createdAt": "2026-09-17T18:25:32.000Z"
        }
      ]
    }
  }
}
```
- **`400 Bad Request`**: Malformed conversation UUID.
- **`401 Unauthorized`**: Missing or invalid JWT.
- **`404 Not Found`**: Conversation not found or belongs to another user.

---

### 2.4 Send Message to Conversation
Sends a user message to an existing conversation. The message triggers conversational memory recall, query rewriting, hybrid RAG retrieval against the user's knowledge base, and Groq LLM inference. Both user and assistant messages are persisted in PostgreSQL.

- **Method**: `POST`
- **Path**: `/conversations/:id/messages` (alias: `/api/conversations/:id/messages`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | **Yes** | Unique identifier of the target conversation. |

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `message` | `string` | **Yes\*** | User query/prompt. (\*Can also use `content` or `query`). |
| `content` | `string` | No | Alternative key for `message`. |
| `query` | `string` | No | Alternative key for `message`. |
| `topK` | `number` | No | Max relevant chunks to pass to LLM (default: `5`). |
| `rrfK` | `number` | No | Reciprocal Rank Fusion smoothing factor (default: `60`). |

```json
{
  "message": "Can you summarize the top risks mentioned?",
  "topK": 3
}
```

#### Responses

- **`200 OK` (Standard Grounded Answer)**:
```json
{
  "success": true,
  "data": {
    "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
    "userMessage": {
      "id": "848da075-802c-4ec7-b087-0b1a0e1c6b12",
      "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "role": "user",
      "content": "Can you summarize the top risks mentioned?",
      "createdAt": "2026-09-17T18:25:30.000Z"
    },
    "assistantMessage": {
      "id": "6e4df9d1-cbf7-4c40-a3ce-8c9df4ec2b65",
      "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "role": "assistant",
      "content": "The top risks identified are supply chain volatility and inflation.",
      "metadata": {
        "sources": [
          {
            "index": 1,
            "chunkId": "chunk:doc123:v1:2",
            "filename": "risk_assessment.txt",
            "content": "Identified operational risks include supply chain delays...",
            "relevanceScore": 0.89
          }
        ],
        "pipelineStats": {
          "semanticRetrieved": 15,
          "lexicalRetrieved": 3,
          "rrfCandidates": 15,
          "rerankedChunks": 3,
          "passedThresholdChunks": 1,
          "scoreThreshold": 0.6,
          "durationMs": 1820
        },
        "originalQuery": "Can you summarize the top risks mentioned?",
        "rewrittenQuery": "Summarize top operational and financial risks",
        "queryRewriteStatus": "rewritten"
      },
      "createdAt": "2026-09-17T18:25:33.000Z"
    },
    "answer": "The top risks identified are supply chain volatility and inflation.",
    "sources": [
      {
        "index": 1,
        "chunkId": "chunk:doc123:v1:2",
        "filename": "risk_assessment.txt",
        "content": "Identified operational risks include supply chain delays...",
        "relevanceScore": 0.89
      }
    ],
    "pipelineStats": {
      "semanticRetrieved": 15,
      "lexicalRetrieved": 3,
      "rrfCandidates": 15,
      "rerankedChunks": 3,
      "passedThresholdChunks": 1,
      "scoreThreshold": 0.6,
      "durationMs": 1820
    },
    "rewrittenQuery": "Summarize top operational and financial risks"
  }
}
```

- **`200 OK` (Query Clarification Needed)**:
Returned when the user query is ambiguous, allowing a natural conversational clarification dialogue.
```json
{
  "success": true,
  "status": "clarify",
  "data": {
    "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
    "userMessage": {
      "id": "b1a20e1c-802c-4ec7-b087-848da0756b12",
      "role": "user",
      "content": "Tell me more about it."
    },
    "assistantMessage": {
      "id": "4df9d16e-cbf7-4c40-a3ce-8c9df4ec2b65",
      "role": "assistant",
      "content": "Could you please specify which topic from our previous discussion you would like to explore?"
    },
    "answer": "Could you please specify which topic from our previous discussion you would like to explore?",
    "status": "clarify"
  }
}
```

- **`400 Bad Request`**: Missing message content or invalid conversation UUID.
- **`401 Unauthorized`**: Missing or invalid JWT.
- **`404 Not Found`**: Conversation not found or belongs to another user.
- **`500 Internal Server Error`**: Retrieval or LLM generation failure.

---

### 2.5 Delete Conversation
Deletes a conversation. All messages belonging to this conversation are automatically deleted via database cascade.

- **Method**: `DELETE`
- **Path**: `/conversations/:id` (alias: `/api/conversations/:id`)
- **Access**: 🔒 Protected (JWT required)
- **Headers**:
  - `Authorization: Bearer <token>`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` (UUID) | **Yes** | Unique identifier of the conversation to delete. |

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Conversation deleted successfully."
}
```
- **`400 Bad Request`**: Invalid UUID format.
- **`401 Unauthorized`**: Missing or invalid JWT.
- **`404 Not Found`**: Conversation not found or not owned by user.

---

## 3. Knowledge Base Document Ingestion Endpoints

Routes: `/rag/*` (and root `/`)

> [!IMPORTANT]
> The document upload and ingestion endpoints (`/upload-url`, `/presigned-url`, `/injestTXT`, and `/job-status/:jobId`) are restricted strictly to users with the **`Admin`** role. Calls from `Customer` or `Support Agent` roles return `403 Forbidden`. Calls without a valid Bearer token return `401 Unauthorized`.

---

### 3.1 Generate Presigned Upload URL
Generates an AWS S3 presigned `PUT` URL so client applications can upload files directly to S3 without sending raw file binaries through the Node.js API server.

- **Method**: `POST`
- **Path**: `/rag/upload-url` (aliases: `/upload-url`, `/rag/presigned-url`, `/presigned-url`)
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <admin_token>`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `filename` | `string` | **Yes** | Name of the file to upload (e.g. `policy.txt`). |
| `mimeType` | `string` | No | Content MIME type (defaults to `"text/plain"`). |
| `userId` | `string` (UUID) | No | Scopes storage path to user (defaults to authenticated Admin's `userId`). |
| `expiresIn` | `number` | No | URL expiration time in seconds (default: `3600`). |

```json
{
  "filename": "quarterly_financials.txt",
  "mimeType": "text/plain",
  "expiresIn": 3600
}
```

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Presigned upload URL generated successfully.",
  "data": {
    "uploadUrl": "https://rag-pipeline-bucket-private.s3.eu-north-1.amazonaws.com/uploads/c8f619b0-13d8-4fbb-a178-57796dcfbd1e/3a1c62f2-quarterly_financials.txt?X-Amz-Algorithm=...",
    "key": "uploads/c8f619b0-13d8-4fbb-a178-57796dcfbd1e/3a1c62f2-quarterly_financials.txt",
    "expiresIn": 3600,
    "method": "PUT",
    "contentType": "text/plain",
    "requiredHeaders": {
      "Content-Type": "text/plain"
    }
  }
}
```
- **`400 Bad Request`**: Missing `filename`.
- **`401 Unauthorized`**: Missing or invalid JWT Bearer token.
- **`403 Forbidden`**: Authenticated user is not an Admin.

---

### 3.2 Queue Document Ingestion
Registers a document record in PostgreSQL (attributing to the Admin's `userId` and `organisationId`) and enqueues an asynchronous background job in BullMQ to download the file from S3, split it into chunks, enrich chunks with metadata, compute embeddings, and store them into the Redis Vector Store.

- **Method**: `POST`
- **Path**: `/rag/injestTXT` (alias: `/injestTXT`)
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Content-Type: application/json`
  - `Authorization: Bearer <admin_token>`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `s3Key` | `string` | **Yes** | Storage key returned from `/rag/upload-url`. |
| `filename` | `string` | No | Original filename (default: basename of `s3Key`). |
| `mimeType` | `string` | No | File MIME type (default: `"text/plain"`). |
| `documentId` | `string` (UUID) | No | Custom UUID for the document (auto-generated if omitted). |
| `userId` | `string` (UUID) | No | Owner user ID (derived from authenticated Admin). |
| `version` | `number` | No | Version number (defaults to `1`). |
| `chunkSize` | `number` | No | Token/character size for chunk splitting. |
| `chunkOverlap` | `number` | No | Overlap between consecutive chunks. |
| `metadata` | `object` | No | Custom key-value pairs to attach to every chunk. |

```json
{
  "s3Key": "uploads/c8f619b0-13d8-4fbb-a178-57796dcfbd1e/3a1c62f2-quarterly_financials.txt",
  "filename": "quarterly_financials.txt",
  "mimeType": "text/plain",
  "chunkSize": 800,
  "chunkOverlap": 150,
  "metadata": {
    "department": "Finance",
    "year": 2026
  }
}
```

#### Responses
- **`202 Accepted`**: Job successfully enqueued.
```json
{
  "success": true,
  "message": "Document ingestion job queued successfully.",
  "data": {
    "jobId": "14",
    "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "filename": "quarterly_financials.txt",
    "status": "PENDING",
    "queuedAt": "2026-09-17T18:30:00.000Z"
  }
}
```
- **`400 Bad Request`**: Missing `s3Key`.
- **`401 Unauthorized`**: Missing or invalid JWT Bearer token.
- **`403 Forbidden`**: Authenticated user is not an Admin.
- **`500 Internal Server Error`**: Database or Redis queue failure.

---

### 3.3 Check Ingestion Job Status
Check the status, progress percentage, and results of an ongoing or completed document ingestion job.

- **Method**: `GET`
- **Path**: `/rag/job-status/:jobId` (alias: `/job-status/:jobId`)
- **Access**: 🔒 Protected (**Admin role only**)
- **Headers**:
  - `Authorization: Bearer <admin_token>`

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `jobId` | `string` | **Yes** | The BullMQ job ID returned from `/rag/injestTXT`. |

#### Responses
- **`200 OK` (Completed Job)**:
```json
{
  "success": true,
  "data": {
    "jobId": "14",
    "state": "completed",
    "progress": 100,
    "result": {
      "success": true,
      "documentId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "version": 1,
      "totalChunks": 24,
      "processedAt": "2026-09-17T18:30:15.000Z",
      "source": "uploads/.../quarterly_financials.txt"
    },
    "timestamp": 1789649415000,
    "processedOn": 1789649416000,
    "finishedOn": 1789649420000
  }
}
```
- **`401 Unauthorized`**: Missing or invalid JWT Bearer token.
- **`403 Forbidden`**: Authenticated user is not an Admin.
- **`404 Not Found`**: Job ID does not exist in Redis queue.

---

## 4. Stateless Chat & Retrieval Endpoint

Route: `POST /rag/chat` (alias: `/chat`)

---

### 4.1 Stateless Hybrid RAG Query
Perform a direct, stateless query against the knowledge base without creating a persistent conversation in PostgreSQL. Runs dense semantic vector search, sparse BM25 lexical search, Reciprocal Rank Fusion (RRF), Cohere cross-encoder reranking, and Groq LLM answer generation.

- **Method**: `POST`
- **Path**: `/rag/chat` (alias: `/chat`)
- **Access**: 🌐 Public / Optional Auth
- **Headers**:
  - `Content-Type: application/json`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | The question or prompt to run against the knowledge base. |
| `topK` | `number` | No | Number of top reranked chunks to inject into context (default: `5`). |
| `rrfK` | `number` | No | Reciprocal Rank Fusion constant (default: `60`). |
| `userId` | `string` (UUID) | No | Filter knowledge base retrieval to documents belonging to this user. |
| `history` | `Array<object>` | No | Array of previous conversation turns `[{ role: "user" \| "assistant", content: string }]`. |

```json
{
  "query": "What were the total expenses in Q2?",
  "topK": 5,
  "history": [
    { "role": "user", "content": "Hello!" },
    { "role": "assistant", "content": "Hello! How can I help you today?" }
  ]
}
```

#### Responses
- **`200 OK` (Answer Returned)**:
```json
{
  "success": true,
  "message": "Chat query processed successfully.",
  "data": {
    "query": "What were the total expenses in Q2?",
    "answer": "According to the financial statement, total expenses for Q2 were $8.5M.",
    "sources": [
      {
        "index": 1,
        "chunkId": "chunk:doc55:v1:3",
        "filename": "q2_expenses.txt",
        "content": "Q2 operational expenses totaled $8.5M...",
        "relevanceScore": 0.94
      }
    ],
    "context": "[Source 1: q2_expenses.txt (ID: chunk:doc55:v1:3 | Relevance: 94.0%)]\nQ2 operational expenses totaled $8.5M...",
    "pipelineStats": {
      "semanticRetrieved": 15,
      "lexicalRetrieved": 5,
      "rrfCandidates": 18,
      "rerankedChunks": 5,
      "passedThresholdChunks": 1,
      "scoreThreshold": 0.6,
      "durationMs": 1340
    },
    "originalQuery": "What were the total expenses in Q2?",
    "rewrittenQuery": "What were the total expenses in Q2?",
    "queryRewriteStatus": "clear"
  }
}
```

- **`200 OK` (Clarification Requested)**:
```json
{
  "success": true,
  "status": "clarify",
  "message": "Could you please specify which quarter or fiscal year you are referring to?",
  "data": {
    "status": "clarify",
    "clarification": "Could you please specify which quarter or fiscal year you are referring to?",
    "originalQuery": "What were the expenses?"
  }
}
```

- **`400 Bad Request`**: Missing or empty `query`.
- **`500 Internal Server Error`**: Retrieval or LLM generation error.

---

## 5. System Health

### 5.1 Health Check
Check server liveness and current timestamp.

- **Method**: `GET`
- **Path**: `/health`
- **Access**: 🌐 Public
- **Headers**: None required.

#### Responses
- **`200 OK`**:
```json
{
  "status": "ok",
  "timestamp": "2026-09-17T18:40:00.000Z"
}
```

---

## 📊 Summary Table of Endpoints

| Category | Method | Endpoint | Access | Summary |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `GET` | `/auth/organisations` | Public | List available organisations |
| **Auth** | `POST` | `/auth/register` | Public | Unified registration (Admin, Agent, Customer) |
| **Auth** | `POST` | `/auth/register/admin` | Public | Register Admin and create Organisation |
| **Auth** | `POST` | `/auth/register/support-agent` | Public | Register Support Agent (Pending approval) |
| **Auth** | `POST` | `/auth/register/customer` | Public | Register Customer for an organisation |
| **Auth** | `POST` | `/auth/login` | Public | Authenticate user and get JWT |
| **Auth** | `GET` | `/auth/me` | Protected | Fetch profile and organisation details |
| **Admin** | `GET` | `/auth/organisation/support-agents` | Protected (Admin) | List support agents for organisation |
| **Admin** | `POST` | `/auth/organisation/support-agents/:id/approve` | Protected (Admin) | Approve pending support agent |
| **Admin** | `POST` | `/auth/organisation/support-agents/:id/reject` | Protected (Admin) | Reject pending support agent |
| **Conversations** | `POST` | `/conversations` | Protected (Active) | Start a new conversation |
| **Conversations** | `GET` | `/conversations` | Protected (Active) | List user's conversations |
| **Conversations** | `GET` | `/conversations/:id` | Protected (Active) | Get conversation with messages |
| **Conversations** | `POST` | `/conversations/:id/messages`| Protected (Active) | Send message, run RAG & persist |
| **Conversations** | `DELETE`| `/conversations/:id` | Protected (Active) | Delete conversation & messages |
| **Ingestion** | `POST` | `/rag/upload-url` | Protected (Admin) | Get S3 presigned upload URL |
| **Ingestion** | `POST` | `/rag/injestTXT` | Protected (Admin) | Queue file ingestion into Redis |
| **Ingestion** | `GET` | `/rag/job-status/:jobId` | Protected (Admin) | Check status of ingestion job |
| **Chat** | `POST` | `/rag/chat` | Public/Auth | Stateless RAG retrieval & LLM |
| **System** | `GET` | `/health` | Public | Server health check |


