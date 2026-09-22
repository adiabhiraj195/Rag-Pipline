# RAG Pipeline & Conversational AI API Documentation

Comprehensive API documentation for the RAG Pipeline platform, designed for frontend developers integrating User Authentication, Interactive Conversational AI, Knowledge Base Document Ingestion, and Document Viewing & Management.

---

## 📌 Base URLs & Environment

The backend server listens on `PORT` (default `8000`).

- **Base URL**: `http://localhost:8000`
- **CORS**: Enabled for all origins (`*`) by default.
- **Common Route Prefixes**:
  - Auth: `/auth` (alias: `/api/auth`)
  - Conversations: `/conversations` (alias: `/api/conversations`)
  - Documents: `/documents` (alias: `/api/documents`, `/rag/documents`)
  - RAG / Ingestion: `/rag` (also available at root `/`)

---

## 🔐 Authentication Scheme

Endpoints marked with **🔒 Protected** require a valid JSON Web Token (JWT) in the HTTP `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

- Tokens are obtained via `POST /auth/register` or `POST /auth/login`.
- Token validity: **7 days** by default.
- Endpoints marked with **🔓 Optional Auth** automatically extract user context if the Bearer token is provided, but also function for anonymous/public visitors.

---

## 📑 Table of Contents

1. [Authentication Endpoints](#1-authentication-endpoints)
   - [1.1 Register User](#11-register-user) (`POST /auth/register`)
   - [1.2 Login User](#12-login-user) (`POST /auth/login`)
   - [1.3 Get Current User Profile](#13-get-current-user-profile) (`GET /auth/me`)
2. [Conversation & Messaging Endpoints](#2-conversation--messaging-endpoints)
   - [2.1 Create Conversation](#21-create-conversation) (`POST /conversations`)
   - [2.2 List User Conversations](#22-list-user-conversations) (`GET /conversations`)
   - [2.3 Get Conversation by ID](#23-get-conversation-by-id) (`GET /conversations/:id`)
   - [2.4 Send Message & Run RAG](#24-send-message--run-rag) (`POST /conversations/:id/messages`)
   - [2.5 Delete Conversation](#25-delete-conversation) (`DELETE /conversations/:id`)
3. [Document Viewing & Management Endpoints](#3-document-viewing--management-endpoints)
   - [3.1 List Uploaded Documents](#31-list-uploaded-documents) (`GET /documents`)
   - [3.2 Get Document Details by ID](#32-get-document-details-by-id) (`GET /documents/:id`)
   - [3.3 Get Document Content for Inline Preview](#33-get-document-content-for-inline-preview) (`GET /documents/:id/content`)
   - [3.4 Get Presigned View / Download URL](#34-get-presigned-view--download-url) (`GET /documents/:id/view-url`)
   - [3.5 Delete Document](#35-delete-document) (`DELETE /documents/:id`)
4. [Document Ingestion Pipeline](#4-document-ingestion-pipeline)
   - [4.1 Generate Presigned Upload URL](#41-generate-presigned-upload-url) (`POST /rag/upload-url`)
   - [4.2 Direct S3 File Upload](#42-direct-s3-file-upload) (`PUT <presignedUrl>`)
   - [4.3 Queue Ingestion Job](#43-queue-ingestion-job) (`POST /rag/injestTXT`)
   - [4.4 Check Ingestion Job Status](#44-check-ingestion-job-status) (`GET /rag/job-status/:jobId`)
5. [Stateless Chat & Retrieval Endpoint](#5-stateless-chat--retrieval-endpoint)
   - [5.1 Stateless Hybrid RAG Query](#51-stateless-hybrid-rag-query) (`POST /rag/chat`)
6. [System Health](#6-system-health)
   - [6.1 Health Check](#61-health-check) (`GET /health`)
7. [Frontend TypeScript Interfaces](#7-frontend-typescript-interfaces)
8. [Frontend Integration Code Examples](#8-frontend-integration-code-examples)
9. [Summary Table of All Endpoints](#9-summary-table-of-all-endpoints)

---

## 1. Authentication Endpoints

Base path: `/auth` (or `/api/auth`)

### 1.1 Register User
Create a new user account and obtain an initial JWT token.

- **Method**: `POST`
- **Path**: `/auth/register` (alias: `/api/auth/register`)
- **Access**: 🌐 Public
- **Headers**: `Content-Type: application/json`

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `email` | `string` | **Yes** | Valid email address containing `@`. |
| `password` | `string` | **Yes** | Account password (min 6 characters). |
| `name` | `string` | No | User's full or display name. |
| `role` | `string` | No | User role (defaults to `"user"`). |

```json
{
  "email": "jane@example.com",
  "password": "SecurePassword123!",
  "name": "Jane Doe",
  "role": "user"
}
```

#### Responses
- **`201 Created`**:
```json
{
  "success": true,
  "message": "User registered successfully.",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "role": "user",
      "createdAt": "2026-09-17T18:20:00.000Z"
    }
  }
}
```
- **`400 Bad Request`**: Validation error (invalid email or password < 6 chars).
- **`409 Conflict`**: Email already registered.

---

### 1.2 Login User
Authenticate existing user and obtain a JWT token.

- **Method**: `POST`
- **Path**: `/auth/login` (alias: `/api/auth/login`)
- **Access**: 🌐 Public
- **Headers**: `Content-Type: application/json`

#### Request Body
```json
{
  "email": "jane@example.com",
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
      "id": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "role": "user",
      "createdAt": "2026-09-17T18:20:00.000Z"
    }
  }
}
```
- **`401 Unauthorized`**: Invalid email or password.

---

### 1.3 Get Current User Profile
Fetch account details of the currently logged-in user.

- **Method**: `GET`
- **Path**: `/auth/me` (alias: `/api/auth/me`)
- **Access**: 🔒 Protected (Requires Bearer token)
- **Headers**: `Authorization: Bearer <token>`

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "email": "jane@example.com",
      "name": "Jane Doe",
      "role": "user",
      "createdAt": "2026-09-17T18:20:00.000Z",
      "updatedAt": "2026-09-17T18:20:00.000Z"
    }
  }
}
```
- **`401 Unauthorized`**: Missing or expired token.

---

## 2. Conversation & Messaging Endpoints

Base path: `/conversations` (or `/api/conversations`)  
All endpoints in this section are **🔒 Protected**.

### 2.1 Create Conversation
Initialize a new conversation session for the authenticated user.

- **Method**: `POST`
- **Path**: `/conversations`
- **Access**: 🔒 Protected

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `title` | `string` | No | Initial title (defaults to `"New Conversation"`). |

```json
{
  "title": "Q3 Financial Analysis"
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
      "title": "Q3 Financial Analysis",
      "createdAt": "2026-09-17T18:25:00.000Z",
      "updatedAt": "2026-09-17T18:25:00.000Z"
    }
  }
}
```

---

### 2.2 List User Conversations
Retrieve all conversations owned by the logged-in user, ordered by most recently updated.

- **Method**: `GET`
- **Path**: `/conversations`
- **Access**: 🔒 Protected

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
        "title": "Q3 Financial Analysis",
        "createdAt": "2026-09-17T18:25:00.000Z",
        "updatedAt": "2026-09-17T18:26:00.000Z",
        "_count": {
          "messages": 4
        }
      }
    ]
  }
}
```

---

### 2.3 Get Conversation by ID
Fetch full conversation details including chronological chat message history.

- **Method**: `GET`
- **Path**: `/conversations/:id`
- **Access**: 🔒 Protected

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "conversation": {
      "id": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "title": "Q3 Financial Analysis",
      "createdAt": "2026-09-17T18:25:00.000Z",
      "updatedAt": "2026-09-17T18:26:00.000Z",
      "messages": [
        {
          "id": "848da075-802c-4ec7-b087-0b1a0e1c6b12",
          "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
          "role": "user",
          "content": "What were the primary revenue drivers in Q3?",
          "metadata": null,
          "createdAt": "2026-09-17T18:25:30.000Z"
        },
        {
          "id": "6e4df9d1-cbf7-4c40-a3ce-8c9df4ec2b65",
          "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
          "role": "assistant",
          "content": "The primary revenue drivers were Cloud services and enterprise subscriptions...",
          "metadata": {
            "sources": [
              {
                "index": 1,
                "chunkId": "chunk:doc123:v1:0",
                "filename": "q3_revenue.txt",
                "content": "Cloud subscriptions contributed 45% of total revenue...",
                "relevanceScore": 0.92
              }
            ],
            "rewrittenQuery": "What were the primary revenue drivers in Q3?"
          },
          "createdAt": "2026-09-17T18:25:33.000Z"
        }
      ]
    }
  }
}
```
- **`404 Not Found`**: Conversation not found or does not belong to the user.

---

### 2.4 Send Message & Run RAG
Send a new user query to the conversation. This triggers query rewriting, hybrid RAG retrieval, LLM synthesis, and automatically saves both the user query and the assistant's answer with citations.

- **Method**: `POST`
- **Path**: `/conversations/:id/messages`
- **Access**: 🔒 Protected

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `message` | `string` | **Yes** | The user's query/prompt (aliases: `content`, `query`). |
| `topK` | `number` | No | Final top chunks to feed LLM (default `5`). |
| `rrfK` | `number` | No | Reciprocal Rank Fusion constant (default `60`). |

```json
{
  "message": "Can you summarize the top risks mentioned in the report?",
  "topK": 5
}
```

#### Responses
- **`200 OK` (Answer Grounded in Knowledge Base)**:
```json
{
  "success": true,
  "data": {
    "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
    "userMessage": {
      "id": "848da075-802c-4ec7-b087-0b1a0e1c6b12",
      "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
      "role": "user",
      "content": "Can you summarize the top risks mentioned in the report?",
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
        "originalQuery": "Can you summarize the top risks mentioned in the report?",
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
When the query is ambiguous, the assistant asks for clarification before running RAG:
```json
{
  "success": true,
  "status": "clarify",
  "data": {
    "conversationId": "673fbb36-96b6-4ae2-bc62-5201ec74971d",
    "userMessage": {
      "id": "b1a20e1c-802c-4ec7-b087-848da0756b12",
      "role": "user",
      "content": "Tell me more."
    },
    "assistantMessage": {
      "id": "4df9d16e-cbf7-4c40-a3ce-8c9df4ec2b65",
      "role": "assistant",
      "content": "Could you please specify which topic or section you would like to explore?",
      "metadata": {
        "status": "clarify"
      }
    },
    "answer": "Could you please specify which topic or section you would like to explore?",
    "status": "clarify"
  }
}
```

---

### 2.5 Delete Conversation
Delete a conversation and all its messages.

- **Method**: `DELETE`
- **Path**: `/conversations/:id`
- **Access**: 🔒 Protected

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Conversation deleted successfully."
}
```

---

## 3. Document Viewing & Management Endpoints

Base path: `/documents` (aliases: `/api/documents`, `/rag/documents`)  
Access: 🔓 **Optional Auth** (If a Bearer token is provided, requests are scoped to the authenticated user by default; unauthenticated callers can list all public documents or query by `userId`).

### 3.1 List Uploaded Documents
Retrieve a paginated list of all documents uploaded to the RAG knowledge base.

- **Method**: `GET`
- **Path**: `/documents`
- **Access**: 🔓 Optional Auth

#### Query Parameters
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `page` | `number` | `1` | Page number (1-indexed). |
| `limit` | `number` | `20` | Documents per page (max 100). |
| `status` | `string` | - | Filter by status: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. |
| `userId` | `string` | - | Filter documents uploaded by a specific user UUID. |
| `search` | `string` | - | Case-insensitive search matching `filename`. |
| `all` | `string` | `"false"` | If logged in, pass `all=true` to view all documents across the system. |
| `sortBy` | `string` | `"createdAt"` | Field to sort by: `createdAt`, `updatedAt`, `filename`, `status`, `version`. |
| `order` | `string` | `"desc"` | Sort direction: `asc` or `desc`. |

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "85391e25-2acb-4f30-bb24-0ae578bfd3de",
        "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
        "filename": "financial-report-2025.txt",
        "mimeType": "text/plain",
        "s3Key": "uploads/c8f619b0.../financial-report-2025.txt",
        "status": "COMPLETED",
        "version": 1,
        "createdAt": "2026-09-21T20:51:38.000Z",
        "updatedAt": "2026-09-21T20:52:10.000Z",
        "user": {
          "id": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
          "email": "jane@example.com",
          "name": "Jane Doe",
          "role": "user"
        }
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalCount": 1,
      "totalPages": 1,
      "hasNextPage": false,
      "hasPrevPage": false
    }
  }
}
```

---

### 3.2 Get Document Details by ID
Retrieve full metadata for a specific document.

- **Method**: `GET`
- **Path**: `/documents/:id`
- **Access**: 🔓 Optional Auth

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "document": {
      "id": "85391e25-2acb-4f30-bb24-0ae578bfd3de",
      "userId": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
      "filename": "financial-report-2025.txt",
      "mimeType": "text/plain",
      "s3Key": "uploads/c8f619b0.../financial-report-2025.txt",
      "status": "COMPLETED",
      "version": 1,
      "createdAt": "2026-09-21T20:51:38.000Z",
      "updatedAt": "2026-09-21T20:52:10.000Z",
      "user": {
        "id": "c8f619b0-13d8-4fbb-a178-57796dcfbd1e",
        "email": "jane@example.com",
        "name": "Jane Doe",
        "role": "user"
      }
    }
  }
}
```
- **`404 Not Found`**: Document ID not found.

---

### 3.3 Get Document Content for Inline Preview
Fetches the raw text content of an uploaded document directly from S3 storage.  
**Frontend Benefit**: Allows the frontend to render the document inside a preview drawer, modal, or editor directly without configuring S3 CORS or managing external signed URLs.

- **Method**: `GET`
- **Path**: `/documents/:id/content`
- **Access**: 🔓 Optional Auth

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "id": "85391e25-2acb-4f30-bb24-0ae578bfd3de",
    "filename": "financial-report-2025.txt",
    "mimeType": "text/plain",
    "status": "COMPLETED",
    "version": 1,
    "s3Key": "uploads/c8f619b0.../financial-report-2025.txt",
    "content": "Q3 Financial Summary\nRevenue: $12.4M\nGross Margin: 68%...",
    "charCount": 1845
  }
}
```

---

### 3.4 Get Presigned View / Download URL
Generates a secure, temporary S3 presigned GET URL for downloading the file or displaying it in an `<iframe>` / new tab.

- **Method**: `GET`
- **Path**: `/documents/:id/view-url` (alias: `/documents/:id/download-url`)
- **Access**: 🔓 Optional Auth

#### Query Parameters
| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `expiresIn` | `number` | `3600` | Expiration time of signed URL in seconds (max 604800 / 7 days). |

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "data": {
    "id": "85391e25-2acb-4f30-bb24-0ae578bfd3de",
    "filename": "financial-report-2025.txt",
    "s3Key": "uploads/c8f619b0.../financial-report-2025.txt",
    "downloadUrl": "https://rag-pipeline-bucket.s3.us-east-1.amazonaws.com/uploads/...?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=...",
    "expiresIn": 3600
  }
}
```

---

### 3.5 Delete Document
Deletes a document record from PostgreSQL database, purges all associated vector embeddings and chunk records from the Redis Vector DB, and removes its file object from S3 storage.

- **Method**: `DELETE`
- **Path**: `/documents/:id`
- **Access**: 🔓 Optional Auth

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Document 'financial-report-2025.txt' deleted successfully.",
  "data": {
    "id": "85391e25-2acb-4f30-bb24-0ae578bfd3de",
    "filename": "financial-report-2025.txt",
    "deletedVectorChunks": 18
  }
}
```
- **`404 Not Found`**: Document not found.


---

## 4. Document Ingestion Pipeline

Ingesting a document into the RAG pipeline is a 4-step asynchronous workflow:

```
[1. Request Upload URL] ---> [2. Direct PUT to S3] ---> [3. Queue Ingestion Job] ---> [4. Poll Job Status]
```

### 4.1 Generate Presigned Upload URL
Generates a secure S3 presigned PUT URL for client-side direct upload.

- **Method**: `POST`
- **Path**: `/rag/upload-url` (alias: `/upload-url`)
- **Access**: 🌐 Public / Optional Auth

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `filename` | `string` | **Yes** | Name of the file being uploaded (e.g. `"handbook.txt"`). |
| `mimeType` | `string` | No | MIME type (default: `"text/plain"`). |
| `expiresIn` | `number` | No | Expiry in seconds (default: `3600`). |

```json
{
  "filename": "employee-handbook-2026.txt",
  "mimeType": "text/plain"
}
```

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Presigned upload URL generated successfully.",
  "data": {
    "presignedUrl": "https://rag-pipeline-bucket.s3.us-east-1.amazonaws.com/uploads/general/uuid-handbook.txt?...",
    "s3Key": "uploads/general/uuid-handbook.txt",
    "bucket": "rag-pipeline-bucket",
    "expiresIn": 3600,
    "filename": "employee-handbook-2026.txt",
    "mimeType": "text/plain"
  }
}
```

---

### 4.2 Direct S3 File Upload
Upload the file content directly from the browser to Amazon S3 using the `presignedUrl` from step 4.1.

- **Method**: `PUT`
- **URL**: `<presignedUrl>`
- **Headers**:
  - `Content-Type: text/plain` (must match `mimeType` provided in step 4.1)
- **Body**: Raw file binary or text

```javascript
// Browser upload example
await fetch(presignedUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain' },
  body: fileObject,
});
```

---

### 4.3 Queue Ingestion Job
Notify the backend that the file is in S3 and queue the background parsing, chunking, enrichment, vector embedding, and Redis indexing job.

- **Method**: `POST`
- **Path**: `/rag/injestTXT` (alias: `/injestTXT`)
- **Access**: 🌐 Public / Optional Auth

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `s3Key` | `string` | **Yes** | The `s3Key` returned in step 4.1. |
| `filename` | `string` | **Yes** | File display name. |
| `mimeType` | `string` | No | File MIME type (default: `"text/plain"`). |
| `chunkSize` | `number` | No | Chunk size in characters (default `800`). |
| `chunkOverlap` | `number` | No | Overlap in characters (default `100`). |
| `metadata` | `object` | No | Custom JSON key-values attached to all chunks. |

```json
{
  "s3Key": "uploads/general/uuid-handbook.txt",
  "filename": "employee-handbook-2026.txt",
  "mimeType": "text/plain",
  "chunkSize": 800,
  "chunkOverlap": 100
}
```

#### Responses
- **`202 Accepted`**:
```json
{
  "success": true,
  "message": "Document ingestion job queued successfully.",
  "data": {
    "jobId": "14",
    "queueName": "document-ingestion",
    "documentId": "48805a5b-93ff-4076-a077-40ff1100f913",
    "filename": "employee-handbook-2026.txt",
    "mimeType": "text/plain",
    "s3Key": "uploads/general/uuid-handbook.txt",
    "status": "PENDING",
    "chunkSize": 800,
    "chunkOverlap": 100
  }
}
```

---

### 4.4 Check Ingestion Job Status
Check the progress and status of a running background ingestion job.

- **Method**: `GET`
- **Path**: `/rag/job-status/:jobId` (alias: `/job-status/:jobId`)
- **Access**: 🌐 Public

#### Responses
- **`200 OK` (Completed Job)**:
```json
{
  "success": true,
  "data": {
    "jobId": "14",
    "state": "completed",
    "progress": 100,
    "data": {
      "documentId": "48805a5b-93ff-4076-a077-40ff1100f913",
      "filename": "employee-handbook-2026.txt"
    },
    "result": {
      "success": true,
      "documentId": "48805a5b-93ff-4076-a077-40ff1100f913",
      "totalChunks": 24,
      "processedAt": "2026-09-17T18:32:00.000Z"
    },
    "failedReason": null
  }
}
```

- **`200 OK` (Processing Job)**:
`state` will be `"active"`, and `progress` will be between `1` and `90` (15: S3 download, 35: chunking, 55: LLM enrichment, 75: vector embedding, 90: DB update).

- **`200 OK` (Failed Job)**:
`state` will be `"failed"`, and `failedReason` contains the error message.

---

## 5. Stateless Chat & Retrieval Endpoint

### 5.1 Stateless Hybrid RAG Query
Perform a one-off retrieval-augmented generation query without persisting messages in a conversation history.

- **Method**: `POST`
- **Path**: `/rag/chat` (alias: `/chat`)
- **Access**: 🌐 Public / Optional Auth

#### Request Body
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `query` | `string` | **Yes** | User's question. |
| `topK` | `number` | No | Final top chunks to feed LLM (default `5`). |
| `history` | `array` | No | Optional array of `{ role: "user" \| "assistant", content: string }`. |

```json
{
  "query": "What is our company's remote work policy?",
  "topK": 5
}
```

#### Responses
- **`200 OK`**:
```json
{
  "success": true,
  "message": "Chat query processed successfully.",
  "data": {
    "query": "What is our company's remote work policy?",
    "answer": "According to the employee handbook, employees are eligible for hybrid work up to 2 days per week...",
    "sources": [
      {
        "index": 1,
        "chunkId": "chunk:doc14:v1:2",
        "filename": "employee-handbook-2026.txt",
        "content": "Section 4.1 Remote Work: Employees can work remotely 2 days per week with manager approval...",
        "relevanceScore": 0.93
      }
    ],
    "pipelineStats": {
      "semanticRetrieved": 15,
      "lexicalRetrieved": 4,
      "rrfCandidates": 16,
      "rerankedChunks": 5,
      "passedThresholdChunks": 2,
      "scoreThreshold": 0.6,
      "durationMs": 1420
    },
    "originalQuery": "What is our company's remote work policy?",
    "rewrittenQuery": "What is our company's remote work policy?",
    "queryRewriteStatus": "clear"
  }
}
```

---

## 6. System Health

### 6.1 Health Check
Check server availability.

- **Method**: `GET`
- **Path**: `/health`
- **Access**: 🌐 Public

#### Responses
- **`200 OK`**:
```json
{
  "status": "ok",
  "timestamp": "2026-09-22T02:20:00.000Z"
}
```

---

## 7. Frontend TypeScript Interfaces

Copy and paste these types directly into your frontend codebase (e.g. `src/types/api.ts`):

```typescript
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
  status?: string;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    messages: number;
  };
  messages?: Message[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: {
    sources?: CitationSource[];
    pipelineStats?: PipelineStats;
    rewrittenQuery?: string;
    originalQuery?: string;
    queryRewriteStatus?: string;
    status?: string;
  } | null;
  createdAt: string;
}

export interface CitationSource {
  index: number;
  chunkId: string;
  filename: string;
  content: string;
  relevanceScore?: number | null;
  chunkIndex?: number;
  totalChunks?: number;
}

export interface PipelineStats {
  semanticRetrieved: number;
  lexicalRetrieved: number;
  rrfCandidates: number;
  rerankedChunks: number;
  passedThresholdChunks: number;
  scoreThreshold: number;
  durationMs: number;
}

export interface SendMessageResponse {
  conversationId: string;
  userMessage: Message;
  assistantMessage: Message;
  answer: string;
  sources?: CitationSource[];
  pipelineStats?: PipelineStats;
  rewrittenQuery?: string;
  status?: string;
}

export interface DocumentItem {
  id: string;
  userId: string | null;
  filename: string;
  mimeType: string;
  s3Key: string;
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  version: number;
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  } | null;
}

export interface DocumentListResponse {
  documents: DocumentItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface DocumentContentResponse {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  version: number;
  s3Key: string;
  content: string;
  charCount: number;
}

export interface DocumentDownloadUrlResponse {
  id: string;
  filename: string;
  s3Key: string;
  downloadUrl: string;
  expiresIn: number;
}

export interface IngestionUploadUrlResponse {
  presignedUrl: string;
  s3Key: string;
  bucket: string;
  expiresIn: number;
  filename: string;
  mimeType: string;
}

export interface IngestionJobStatusResponse {
  jobId: string;
  state: "waiting" | "active" | "completed" | "failed" | "delayed";
  progress: number;
  data: Record<string, any>;
  result?: {
    success: boolean;
    documentId: string;
    totalChunks: number;
    processedAt: string;
  } | null;
  failedReason?: string | null;
}
```

---

## 8. Frontend Integration Code Examples

### 8.1 API Client Helper (`src/api/client.ts`)

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "An unexpected error occurred.");
  }
  return data;
}
```

### 8.2 Document Upload & Ingestion Flow (`src/api/documents.ts`)

```typescript
import { apiRequest } from "./client";
import type {
  ApiResponse,
  IngestionUploadUrlResponse,
  IngestionJobStatusResponse,
  DocumentListResponse,
  DocumentContentResponse,
} from "../types/api";

/**
 * 1. Upload a file and start RAG ingestion
 */
export async function uploadAndIngestDocument(
  file: File,
  onProgress?: (progress: number, status: string) => void
): Promise<string> {
  onProgress?.(5, "Requesting upload URL...");
  
  // Step 1: Get presigned upload URL
  const uploadUrlRes = await apiRequest<ApiResponse<IngestionUploadUrlResponse>>(
    "/rag/upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "text/plain",
      }),
    }
  );
  const { presignedUrl, s3Key } = uploadUrlRes.data!;

  // Step 2: Direct PUT to Amazon S3
  onProgress?.(25, "Uploading file to storage...");
  await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "text/plain" },
    body: file,
  });

  // Step 3: Queue ingestion job
  onProgress?.(50, "Queuing RAG ingestion...");
  const queueRes = await apiRequest<ApiResponse<{ jobId: string }>>(
    "/rag/injestTXT",
    {
      method: "POST",
      body: JSON.stringify({
        s3Key,
        filename: file.name,
        mimeType: file.type || "text/plain",
      }),
    }
  );
  const jobId = queueRes.data!.jobId;

  // Step 4: Poll job status until complete
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const statusRes = await apiRequest<ApiResponse<IngestionJobStatusResponse>>(
          `/rag/job-status/${jobId}`
        );
        const job = statusRes.data!;

        onProgress?.(
          Math.min(95, 50 + Math.round(job.progress * 0.45)),
          `Indexing document (${job.progress}%)...`
        );

        if (job.state === "completed") {
          clearInterval(interval);
          onProgress?.(100, "Completed!");
          resolve(job.result!.documentId);
        } else if (job.state === "failed") {
          clearInterval(interval);
          reject(new Error(job.failedReason || "Document ingestion failed."));
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 1500);
  });
}

/**
 * 2. Fetch documents for table/list view
 */
export async function fetchDocuments(params: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  all?: boolean;
} = {}): Promise<DocumentListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.limit) query.set("limit", String(params.limit));
  if (params.search) query.set("search", params.search);
  if (params.status) query.set("status", params.status);
  if (params.all) query.set("all", "true");

  const res = await apiRequest<ApiResponse<DocumentListResponse>>(
    `/documents?${query.toString()}`
  );
  return res.data!;
}

/**
 * 3. Fetch raw document text content for preview modal
 */
export async function fetchDocumentContent(
  documentId: string
): Promise<DocumentContentResponse> {
  const res = await apiRequest<ApiResponse<DocumentContentResponse>>(
    `/documents/${documentId}/content`
  );
  return res.data!;
}

/**
 * 4. Delete document
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await apiRequest(`/documents/${documentId}`, { method: "DELETE" });
}
```

---

## 9. Summary Table of All Endpoints

| Group | Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Auth** | `POST` | `/auth/register` | 🌐 Public | Register new user & receive JWT token |
| **Auth** | `POST` | `/auth/login` | 🌐 Public | Log in with email & password |
| **Auth** | `GET` | `/auth/me` | 🔒 Protected | Get current user profile |
| **Conversations** | `POST` | `/conversations` | 🔒 Protected | Start a new chat conversation |
| **Conversations** | `GET` | `/conversations` | 🔒 Protected | List user's conversations with message counts |
| **Conversations** | `GET` | `/conversations/:id` | 🔒 Protected | Get conversation with all messages & citations |
| **Conversations** | `POST` | `/conversations/:id/messages`| 🔒 Protected | Send query, run RAG pipeline, persist answer |
| **Conversations** | `DELETE`| `/conversations/:id` | 🔒 Protected | Delete conversation and its messages |
| **Documents** | `GET` | `/documents` | 🔓 Optional Auth | List uploaded docs with search & pagination |
| **Documents** | `GET` | `/documents/:id` | 🔓 Optional Auth | Get metadata for a single document |
| **Documents** | `GET` | `/documents/:id/content` | 🔓 Optional Auth | Get raw text content for inline modal preview |
| **Documents** | `GET` | `/documents/:id/view-url` | 🔓 Optional Auth | Get presigned S3 URL for download / iframe |
| **Documents** | `DELETE`| `/documents/:id` | 🔓 Optional Auth | Delete document from PostgreSQL, S3 & Redis Vector DB |
| **Ingestion** | `POST` | `/rag/upload-url` | 🌐 Public / Auth | Get presigned S3 PUT URL for uploading file |
| **Ingestion** | `POST` | `/rag/injestTXT` | 🌐 Public / Auth | Queue background ingestion & Redis vector indexing |
| **Ingestion** | `GET` | `/rag/job-status/:jobId` | 🌐 Public | Poll ingestion job state and progress |
| **Chat** | `POST` | `/rag/chat` | 🌐 Public / Auth | Stateless one-off RAG retrieval & LLM synthesis |
| **System** | `GET` | `/health` | 🌐 Public | Server liveness health check |
