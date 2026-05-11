# Chatbot Codebase - Complete Study

## Project Overview

**Artemis Hospital Chatbot** - A conversational AI chatbot built on **Google Dialogflow CX** framework with a custom web interface, contact form handling, and backend appointment/catalog management system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (HTML/JS)                           │
├─────────────────────────────────────────────────────────────────┤
│  • chat-frame.html          - Main chat UI container            │
│  • company.js               - Core chat logic & handlers        │
│  • company.config.js        - UI configuration & theming       │
│  • company.css              - Styling                           │
│  • company-loader.js        - iframe loader for embedding      │
└─────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────┐
│            Google Dialogflow CX API (NLU Engine)               │
├─────────────────────────────────────────────────────────────────┤
│  • Project: qabot01                                             │
│  • Location: us-central1                                        │
│  • Agent: 9dbd4886-3cbe-43fc-8eb5-54ee5097f25c                │
└─────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────┐
│         Backend API (Node.js/Express)                          │
├─────────────────────────────────────────────────────────────────┤
│  • contact-form-api/index.mjs   - Main REST API                │
│  • POST /contact-form-submissions - Handle form submissions    │
│  • POST /contact-form-mobile-sheet-sync - Mobile sheet sync    │
│  • Integration: Google Sheets, Firestore, Google Drive        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. FRONTEND LAYER

### 1.1 Core Files

#### **chat-frame.html**

- **Purpose**: HTML frame for the entire chat widget
- **Key Features**:
  - Loads Dialogflow messenger CSS & JS
  - Loads all form definitions (contact, feedback, appointment, OTP, upload)
  - Loads configuration files in strict order
  - Sets API base URL via meta tag: `https://handsome-amazement-production-7f65.up.railway.app`
  - Integrates Google Sheets styling for df-messenger

**Script Load Order (Critical)**:

1. Dialogflow CSS
2. company.css
3. forms/\*.js (contact, feedback, appointment variations, otp, upload)
4. company.config.js
5. company.js

#### **company.config.js**

- **Purpose**: Central configuration file for UI/UX
- **Key Sections**:

```javascript
common: {
  dialogflow: {
    projectId: "qabot01",
    location: "us-central1",
    agentId: "9dbd4886-3cbe-43fc-8eb5-54ee5097f25c"
  },

  header: {
    title: "Artemis",
    subtitle: "🟢 We are online to assist you",
    chatIconUrl: "...",
    botWritingText: "Typing"
  },

  botPersona: {
    mode: "image",  // or "emojiTime"
    userPersonaShiftRightPx: 16,
    image: {
      url: "https://storage.googleapis.com/companybucket/Images/cat-icon.png",
      widthPx: 32,
      heightPx: 32,
      showTime: true,
      timeZone: "Asia/Kolkata"
    }
  },

  features: {
    multiLanguage: { enabled: true, codes: ["en", "hi"] },
    restartChat: { enabled: true },
    clientContextCapture: { enabled: true }
  }
}
```

#### **company.js**

- **Purpose**: Main chatbot logic & event handlers
- **Key Responsibilities**:
  1. **Initialization**:
     - Reads `window.COMPANY_CHAT_UI_CONFIG`
     - Attaches event listeners to df-messenger
     - Sets up persona rendering

  2. **Form Handling**:
     - Detects `open_form` payloads from Dialogflow
     - Manages form queue (next_form_id, following_form_id, etc.)
     - Handles form submission & chaining

  3. **Message Processing**:
     - Intercepts user messages & bot responses
     - Applies persona styling (timestamps, avatars)
     - Manages unread message badges on bubble launcher

  4. **Key Constants**:

     ```javascript
     PERSONA_TEXT_COLOR = "#8f1d56";
     CONTACT_FORM_ENDPOINT = "/contact-form-submissions";
     CONTACT_FORM_SUBMIT_FETCH_TIMEOUT_MS = 90000;
     MOBILE_CHAT_BREAKPOINT_PX = 768;
     ```

  5. **Session State**:
     - `bubbleUnreadCount` - Unread messages on launcher
     - `activeContactFormId` - Current open form
     - `isChatWindowOpen` - Chat panel visibility
     - `hasAutoStartedConversation` - Auto-start trigger
     - `pendingNextFormIdsAfterSubmit` - Form queue

#### **company.css**

- Styling for chat widget
- Persona label styling
- Form card styling
- Responsive design (mobile ≤768px)

### 1.2 Forms Integration

Located in `forms/` directory - each is a separate file:

| Form                   | Purpose                      | Fields               |
| ---------------------- | ---------------------------- | -------------------- |
| contact.js             | Capture user details         | name, mobile, email  |
| feedback.js            | Collect feedback             | (custom)             |
| appointment.js         | General appointment booking  | appointment-specific |
| appointment-doctor.js  | Doctor-specific appointments | doctor, date, time   |
| appointment-general.js | General appointments         | service, date, slot  |
| otp.js                 | OTP verification             | otp code             |
| upload.js              | File upload handler          | file input           |

**Form Structure Example (contact.js)**:

```javascript
window.__DFCHAT_FORMS__ = {
  contact: {
    titleByLanguage: { en: "Contact us", hi: "हमसे संपर्क करें" },
    fields: [
      { id: "c-name", name: "name", type: "text", required: true },
      { id: "c-mobile", name: "mobile", type: "tel", required: true },
      { id: "c-email", name: "email", type: "email", required: true },
    ],
  },
};
```

---

## 2. DIALOGFLOW CX LAYER (Artemis Agent)

### 2.1 Agent Configuration

**File**: `artemis_all/agent.json`

```json
{
  "displayName": "Artemis Hospital",
  "defaultLanguageCode": "en",
  "supportedLanguageCodes": ["hi"],
  "timeZone": "America/Los_Angeles",
  "startFlow": "Default Start Flow",
  "enableLogging": true,
  "multiLanguageTraining": true
}
```

### 2.2 Intents (30+ total)

Located in `artemis_all/intents/`

**Intent Categories**:

| Category     | Intents                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| Welcome      | Default Welcome Intent, Globalintent                                            |
| Consultation | Bookconsultation, Boocanother                                                   |
| Services     | mainservices, alldiagnostics, alllabtests                                       |
| Location     | citydirect, statedirect, Ourbranches                                            |
| Diagnostics  | Diagnostics, diagservices, alldiagnostics, otherdiag, xray                      |
| Lab Tests    | Labinvestigation, alllabtests, book package                                     |
| Home Care    | Homecare, homecaredirect, hcother                                               |
| Preventive   | Preventive Health, packagebrochure                                              |
| Callbacks    | Requestcallback                                                                 |
| Admin        | MainMenu, Bye, Default Negative Intent, ThankYou                                |
| Support      | editinfo, fieldtoedit, confirmation, getdoctordetails, Secondopinion, directapp |

### 2.3 Entity Types

Located in `artemis_all/entityTypes/`

**Entities** (data classifiers):

- **city** - Hospital branch locations
- **state** - Geographic states
- **mobile** - Phone numbers
- **patientage** - Age range
- **patientgender** - Gender (M/F)
- **specialization** - Doctor specialties
- **consulationtype** - Consultation types (online, in-person)
- **Diagnostics** - Diagnostic test types
- **Homecare** - Home care services
- **selectedoption** - User selection tracking

### 2.4 Flows (11 main flows)

Located in `artemis_all/flows/`

**Flow Hierarchy**:

```
1. BookConsulationFlow ─→ Handles consultation bookings
   ├─ Pages: gettype, getspecialization, getdoctor, selectslot
   └─ Routes: MainMenu, ThankYou

2. Branchsearch_Direct ─→ Direct branch search
3. OurBranchesFlow ─→ List hospital branches
4. DiagnosticsFlow ─→ Diagnostic services
5. LabInvestigationFlow ─→ Lab test bookings
6. HomeCareFlow ─→ Home care services
7. PreventiveHealthFlow ─→ Preventive packages
8. RequestCallbackFlow ─→ Callback requests
9. SecondOpinionFlow ─→ Second opinion service

+ Default Start Flow ─→ Entry point/welcome
+ MainMenuFlow ─→ Navigation hub
```

**Flow Structure (1-BookConsulationFlow.json)**:

```json
{
  "transitionRoutes": [
    {
      "intent": "Bookconsultation",
      "targetPage": "1-bookcon_gettype",
      "setParameterActions": [...]
    }
  ],
  "eventHandlers": [
    {
      "event": "sys.no-match-default",
      "messages": [...]
    }
  ],
  "nluSettings": {
    "modelType": "MODEL_TYPE_ADVANCED",
    "classificationThreshold": 0.30
  }
}
```

### 2.5 Agent Transition Route Groups

Located in `artemis_all/agentTransitionRouteGroups/`

**Global Routing Rules**:

- **callback.json** - Handles request callback intents
- **diagroute.json** - Diagnostic flow routing
- **Gateway.json** - Main entry routing
- **homecareroute.json** - Home care flow routing
- **Stopchat.json** - Exit/stop conversation

---

## 3. BACKEND API LAYER

### 3.1 Server Setup

**File**: `server/contact-form-api/index.mjs`

**Technology Stack**:

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Database**:
  - Google Firestore (optional, configurable)
  - Google Sheets (for lead tracking)
  - Google Drive (for file uploads)
- **Authentication**: Firebase Admin SDK
- **Email**: Nodemailer (optional notifications)

**Port**: 8080 (default) or from `process.env.PORT`

### 3.2 Main Endpoints

#### **POST /contact-form-submissions**

Handles form submission with support for multipart (files) or JSON

**Request Body**:

```javascript
{
  name: string,
  mobile: string,
  email: string,
  // ... other form fields
  _files: [ { fieldName, filename, base64 } ]  // if file upload
}
```

**Processing Chain**:

1. Validate & sanitize inputs
2. Upload files to Google Drive (if enabled)
3. Append row to Google Sheets (if enabled)
4. Save to Firestore (if enabled)
5. Send email notifications (if configured)
6. Return response with status

**Environment Variables**:

```bash
SHEETS_SPREADSHEET_ID          # Google Sheets ID
GOOGLE_DRIVE_FOLDER_ID         # Drive folder for uploads
GOOGLE_APPS_SCRIPT_WEBAPP_URL   # Apps Script webhook
FIREBASE_SERVICE_ACCOUNT_JSON   # Firebase creds
CORS_ORIGIN                     # CORS setting
DRIVE_ONLY=1                    # Skip Firestore
DISABLE_DRIVE_UPLOAD=1          # File upload disabled
DISABLE_SHEETS=1                # Sheets integration disabled
```

#### **POST /contact-form-mobile-sheet-sync**

Mobile-only chat → Sheet row (no file upload)

**Use Case**: Quick sheet sync for mobile leads

#### **POST /contact-form-session-sheet-sync**

Live-sync user queries to Sheets (User Queries column)

**Optional Auth**: `X-Contact-Form-Mobile-Sync-Secret` header

#### **GET /api/[catalog endpoints]**

- `/api/doctors` - List available doctors
- `/api/branches` - List hospital branches
- `/api/departments` - List departments

#### **POST /api/appointments/book**

Book appointment slots

#### **POST /api/sync-catalog-from-repo**

Sync catalog data from bundled JSON files

- Requires: `X-Catalog-Sync-Secret` header

### 3.3 Key Libraries (package.json)

```json
{
  "cors": "^2.8.6", // CORS middleware
  "express": "^4.21.2", // Web framework
  "nodemailer": "^6.9.16", // Email sending
  "firebase-admin": "^13.6.0", // Firebase backend
  "googleapis": "^169.0.0", // Google APIs (Drive, Sheets)
  "multer": "^1.4.5-lts.1" // File upload handling
}
```

### 3.4 Feature Configurations

#### **Google Sheets Integration**

- Appends lead rows with format mapping
- Columns: name, mobile, email, conversation, source, timestamp
- Extra columns via `sheet-integration.config.json`
- Timezone conversion (Asia/Kolkata default)

#### **Google Drive Upload**

- File size limit: 32MB per file
- Max 30 files per submission
- Storage: Google Drive folder
- Service account or OAuth2

#### **Firestore Storage**

- Backup lead storage
- Deferred write option (write after HTTP 200)
- Document structure mirrors form fields

#### **Email Notifications**

- **SMTP Configuration**: `SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`, `MAIL_PASSWORD`
- **Lead Notification**: Staff notified of new leads
- **Client Acknowledgment**: Auto-reply to visitor
- **Appointment Confirmations**: Dual notification system
- **Templates**: HTML templates in `lib/mail/templates/`

#### **Appointment Management**

- **Slot Booking**: `bookAppointment()` function
- **Slot Retrieval**: `listBookedSlots()` function
- **General Appointment**: Configurable from `company.config.js`
- **Slot Duration**: `generalAppointment.slotMinutes` (5-180 minutes)

### 3.5 Supporting Libraries

**lib/** directory structure:

```
lib/
├── firebase-admin-init.mjs       # Firebase initialization
├── firestore.mjs                 # Firestore operations
├── sheets.mjs                    # Google Sheets API calls
├── drive-upload.mjs              # Google Drive file upload
├── drive-auth.mjs                # Drive authentication
├── apps-script-upload.mjs        # Apps Script integration
├── catalog-rtdb.mjs              # RTDB catalog queries
├── catalog-csv-ingest.mjs        # CSV to RTDB import
├── contact-mobile.mjs            # Mobile field parsing
├── appointments.mjs              # Appointment booking logic
├── company-general-appointment.mjs # General appointment config
├── contact-lead-notify-email.mjs # Lead notification emails
└── mail/
    ├── client-lead-ack-email.mjs
    ├── appointment-client-ack-email.mjs
    ├── appointment-chatbot-staff-notify-email.mjs
    └── templates/
        ├── lead_mail_to_client.html
        ├── appointment_mail_to_user.html
        └── appointment_mail_to_client.html
```

---

## 4. CONFIGURATION MANAGEMENT

### 4.1 chat-frame.html Meta Tags

```html
<meta
  name="dfchat-api-base-url"
  content="https://handsome-amazement-production-7f65.up.railway.app"
/>
```

- Sets API endpoint for contact form submissions
- Overrideable via query parameter `?apiBase=...`

### 4.2 Query Parameters (chat-frame.html)

```
?botid=0001              # Bot identifier
?apiBase=https://...     # Override API endpoint
?hostPage=https://...    # Parent page URL
```

### 4.3 Storage Keys (localStorage)

```javascript
LANGUAGE_STORAGE_KEY = "company_ui_language";
CHAT_CLIENT_CONTEXT_STORAGE_KEY = "company_chat_client_context";
```

---

## 5. CONVERSATION FLOW EXAMPLE

### User Journey: Book a Consultation

```
1. User opens chat
   ↓
2. "Default Welcome Intent" triggered
   ↓
3. MainMenuFlow displays options
   ↓
4. User clicks "Book Consultation"
   ↓
5. "Bookconsultation" intent matched
   ↓
6. BookConsulationFlow started
   ├─ Page 1: "What type of consultation?" (parameters reset)
   ├─ Page 2: "Select specialization"
   ├─ Page 3: "Choose doctor"
   └─ Page 4: "Select available slot"
   ↓
7. Confirmation page
   ↓
8. "open_form" payload triggers Contact Form
   ├─ User enters: name, mobile, email
   └─ Form submits to /contact-form-submissions
   ↓
9. Backend processes:
   ├─ Uploads form data to Sheets
   ├─ Saves to Firestore
   ├─ Sends email notifications
   └─ Returns status
   ↓
10. "ThankYou" intent response
    ↓
11. MainMenuFlow offers next action or exit
```

---

## 6. DATA FLOW DIAGRAM

```
┌──────────────────────────┐
│  User Types in Chat      │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────────────────┐
│ Dialogflow CX NLU Processing         │
│ (Intent matching, entity extraction) │
└───────────┬──────────────────────────┘
            │
            ▼
┌──────────────────────────┐
│  Flow & Page Logic       │
│  (Business logic)        │
└───────────┬──────────────┘
            │
     ┌──────┴──────┐
     │             │
     ▼             ▼
┌─────────┐  ┌──────────────────┐
│ Message │  │ Form Trigger     │
└────┬────┘  └──────────┬───────┘
     │                  │
     │         ┌────────▼────────┐
     │         │  Contact Form   │
     │         │  (User fills)   │
     │         └────────┬────────┘
     │                  │
     │         ┌────────▼────────┐
     │         │ Form Submission │
     │         └────────┬────────┘
     │                  │
     ▼                  ▼
   chat-frame.html   POST /contact-form-submissions
        │                │
        └────┬───────────┘
             │
             ▼
   ┌─────────────────────────┐
   │  Backend API (index.mjs)│
   │  ┌───────────────────┐  │
   │  │ Validate & Parse  │  │
   │  └────────┬──────────┘  │
   │           │             │
   │  ┌────────▼──────────┐  │
   │  │ Upload to Sheets  │  │
   │  └────────┬──────────┘  │
   │           │             │
   │  ┌────────▼──────────┐  │
   │  │ Upload to Drive   │  │
   │  └────────┬──────────┘  │
   │           │             │
   │  ┌────────▼──────────┐  │
   │  │ Save to Firestore │  │
   │  └────────┬──────────┘  │
   │           │             │
   │  ┌────────▼──────────┐  │
   │  │ Send Emails       │  │
   │  └────────┬──────────┘  │
   │           │             │
   │           ▼             │
   │  ┌─────────────────┐   │
   │  │ Return Response │   │
   │  └─────────────────┘   │
   └─────────────────────────┘
```

---

## 7. KEY TECHNOLOGIES

| Component        | Technology               | Purpose                               |
| ---------------- | ------------------------ | ------------------------------------- |
| **NLU**          | Google Dialogflow CX     | Intent recognition, entity extraction |
| **Frontend**     | HTML5, Vanilla JS, CSS3  | Chat UI & forms                       |
| **Backend**      | Node.js, Express.js      | REST API                              |
| **Database**     | Google Firestore, Sheets | Lead storage                          |
| **File Storage** | Google Drive             | Attachment storage                    |
| **Email**        | Nodemailer, SMTP         | Notifications                         |
| **Deployment**   | Railway                  | Hosting (API)                         |
| **Hosting**      | GitHub Pages             | Static assets                         |

---

## 8. CRITICAL INTEGRATION POINTS

### 8.1 Dialogflow → Frontend

- **Messenger**: `df-messenger` custom element
- **Communication**: Automatically via Google's API
- **Triggers**: Custom payloads (`open_form`, `next_form_id`, etc.)

### 8.2 Frontend → Backend

- **Endpoint**: `/contact-form-submissions`
- **Method**: POST (multipart/form-data or JSON)
- **Authentication**: None (CORS enabled)
- **Timeout**: 90 seconds

### 8.3 Backend → External Services

- **Sheets API**: Append rows to spreadsheet
- **Drive API**: Upload files
- **Firestore**: Document writes
- **SMTP**: Email notifications

---

## 9. DEPLOYMENT DETAILS

### 9.1 Frontend Hosting

- **URL**: `https://qabot2026.github.io/testingone/`
- **Assets**:
  - chat-frame.html
  - company.js, company.config.js, company.css
  - forms/\*.js
  - company-loader.js (iframe loader)

### 9.2 Backend Hosting

- **Platform**: Railway.app
- **URL**: `https://handsome-amazement-production-7f65.up.railway.app`
- **Service**: Express.js API
- **Environment**: Configured via Railway dashboard

### 9.3 Integration URL

```html
<script src="https://qabot2026.github.io/testingone/company-loader.js?botid=0001&v=7"></script>
```

---

## 10. FILE STRUCTURE SUMMARY

```
testingone/
├── chat-frame.html                 # Chat widget HTML
├── company.js                      # Main chatbot logic
├── company.config.js               # Configuration
├── company.css                     # Styling
├── company-loader.js               # iframe loader
├── myweb.html                      # Sample host page
├── railway.json                    # Railway deployment config
│
├── forms/                          # Form definitions
│   ├── contact.js
│   ├── feedback.js
│   ├── appointment.js
│   ├── appointment-doctor.js
│   ├── appointment-general.js
│   ├── otp.js
│   └── upload.js
│
├── artemis_all/                    # Dialogflow CX agent
│   ├── agent.json                  # Agent config
│   ├── intents/                    # 30+ intent definitions
│   ├── flows/                      # 11 conversation flows
│   ├── entityTypes/                # Custom entity types
│   ├── agentTransitionRouteGroups/ # Global routing rules
│   ├── generativeSettings/         # Language models
│   └── webhooks/                   # Webhook definitions
│
└── server/
    └── contact-form-api/
        ├── index.mjs               # Express app entry
        ├── package.json            # Dependencies
        ├── env.example.txt         # Environment variables
        ├── sheet-integration.config.json
        ├── sheet-lead.config.json
        │
        ├── lib/                    # Business logic
        │   ├── firebase-admin-init.mjs
        │   ├── firestore.mjs
        │   ├── sheets.mjs
        │   ├── drive-upload.mjs
        │   ├── appointments.mjs
        │   ├── contact-lead-notify-email.mjs
        │   └── mail/               # Email templates
        │
        ├── data/                   # Catalog data
        │   ├── doctors.upload.json
        │   └── branches.upload.json
        │
        ├── public/                 # Static assets
        ├── scripts/                # Utility scripts
        └── examples/               # Integration examples
```

---

## 11. KEY FEATURES

✅ **Multi-language Support** (English, Hindi, Marathi)
✅ **Responsive Design** (Mobile: ≤768px, Desktop: >768px)
✅ **Contact Form with Auto-fill**
✅ **File Upload Support** (Google Drive integration)
✅ **Google Sheets CRM** (Lead tracking)
✅ **Email Notifications** (Staff + Client)
✅ **Appointment Booking System**
✅ **Custom Entity Types** (City, Specialization, etc.)
✅ **Multi-page Flows** (Consultation, Diagnostics, Home Care)
✅ **Context Capture** (Page URL, user session metadata)
✅ **Unread Message Badge** (Chat bubble indicator)
✅ **Auto-start Conversation** (Optional greeting)
✅ **Theme Customization** (Colors, fonts, spacing)

---

## 12. COMMON WORKFLOWS

### 12.1 Adding a New Intent

1. Create folder in `artemis_all/intents/NewIntent/`
2. Add training phrases & responses
3. Link to flow via transition route
4. Deploy to Dialogflow

### 12.2 Creating a New Flow

1. Create folder in `artemis_all/flows/NewFlow/`
2. Define pages & transitions
3. Add pages in `pages/` subfolder
4. Link intents to start page
5. Add global routing in `agentTransitionRouteGroups/`

### 12.3 Adding a Form

1. Create `forms/newform.js`
2. Define fields & validation
3. Add to script tags in `chat-frame.html`
4. Trigger via `open_form` payload from Dialogflow

### 12.4 Backend Configuration

1. Set environment variables on Railway
2. Configure Sheets spreadsheet ID
3. Create Drive folder ID
4. Set up Firebase credentials
5. Configure SMTP for emails

---

## 13. PERFORMANCE & LIMITS

- **Form Submit Timeout**: 90 seconds
- **File Upload Limit**: 32MB per file, 30 files max
- **NLU Threshold**: 0.3 (30% confidence minimum)
- **Session Storage**: localStorage (browser)
- **API Response**: Typically <1s
- **Sheets Append**: Depends on network (usually <3s)

---

## 14. SECURITY CONSIDERATIONS

1. **API Endpoints**: CORS enabled, no authentication required
2. **Files**: Uploaded to Google Drive (encrypted)
3. **Spreadsheets**: Shared with service account
4. **Firestore**: Firebase rules apply
5. **Email**: SMTP with TLS/SSL
6. **Secrets**: Environment variables (Railway)
7. **Query Parameters**: Validate all inputs
8. **Headers**: Catalog sync requires secret token

---

## 15. TROUBLESHOOTING REFERENCE

| Issue                | Cause                      | Solution                          |
| -------------------- | -------------------------- | --------------------------------- |
| Forms not appearing  | Script load order wrong    | Check order in chat-frame.html    |
| No API calls         | API base URL misconfigured | Check meta tag in chat-frame.html |
| Files not uploading  | Drive API disabled         | Enable in Google Cloud Console    |
| Sheets not syncing   | Spreadsheet not shared     | Share with service account email  |
| Emails not sending   | SMTP credentials wrong     | Verify SMTP\_\* env variables     |
| Chat not responding  | Intent not trained         | Retrain in Dialogflow console     |
| Mobile layout broken | CSS viewport missing       | Check company.css media queries   |

---

**Document Generated**: May 11, 2026
**Chatbot Framework**: Google Dialogflow CX
**Backend**: Node.js + Express.js on Railway.app
**Status**: Production-ready
