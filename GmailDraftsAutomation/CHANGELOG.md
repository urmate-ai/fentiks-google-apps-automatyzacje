# Changelog

All notable changes to this project will be documented in this file.

## [2.1.0] - 2025-12-31

### Added
- **Unified Drive Service** (`src/shared/drive/index.ts`)
  - Single, reusable service for all Google Drive operations
  - Consistent error handling and logging
  - Type-safe methods for folder/file operations
  
- **Centralized Folder Structure** (`src/shared/drive/structure.ts`)
  - Single source of truth for folder/file names
  - Helper functions for path construction
  - Validation utilities for folder IDs
  
- **Comprehensive Documentation**
  - `DRIVE_STRUCTURE.md`: Detailed folder structure documentation
  - `REFACTORING_NOTES.md`: Technical refactoring details
  - `.env.example`: Updated with all configuration options

### Changed
- **Gmail Sync Structure**
  - Emails now stored in: `Wiedza z Gmaila/{YEAR}/{MONTH}/{DAY}.jsonl`
  - `processedEmails.jsonl` moved to: `Wiedza z Gmaila/processedEmails.jsonl`
  - Better organization and navigation
  
- **Fentiks Schedule Storage**
  - Changed from: `fentiks/{YEAR}/{MONTH}/{DAY}.jsonl` (multiple JSONL files)
  - Changed to: `terminarz_szkolen.json` (single JSON file in root)
  - Format: JSON array instead of JSONL
  - Automatic sorting by date (newest first)
  - Improved deduplication logic

- **Code Quality**
  - Eliminated code duplication (DRY principle)
  - Improved separation of concerns
  - Better type safety throughout
  - Enhanced error handling

### Deprecated
- `src/gmail-syncer/drive.ts` - Replaced by `src/shared/drive/index.ts`
- `src/fentiks-syncer/drive.ts` - Replaced by `src/shared/drive/index.ts`

### Migration Notes
- Existing data will continue to work
- New structure will be created automatically on first run
- Optional: Manually move year folders into "Wiedza z Gmaila/" for cleaner organization
- Optional: Consolidate old Fentiks JSONL files into new JSON format

## [2.0.0] - 2025-12-30

### Added
- Token Manager UI for OAuth refresh token management
- Database storage for OAuth tokens
- Automatic OAuth callback handling
- Health check endpoint for Render.com deployment
- Chat API with RAG integration
- API versioning (`/api/v1/`)

### Changed
- Improved Gmail API rate limit handling
- Optimized sync intervals (30 min for Gmail, 5 min for automation)
- Better error handling for SIGTERM signals
- Async initial task execution in watch mode

### Fixed
- Port binding for Render.com deployment
- UI file serving in production
- OAuth token refresh logic
- Application shutdown on production

## [1.0.0] - 2025-12-01

### Added
- Initial release
- Gmail sync to Drive
- RAG-based email automation
- Fentiks schedule scraping
- PostgreSQL with pgvector integration
- LangChain integration
- Docker support

