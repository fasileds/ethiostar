/** M08 — Customer Onboarding, KYC & Document Verification. */
export {
  evaluateChecklist,
  assertMayApprove,
  assertRejectionComment,
  documentsExpiringWithin,
  type RequiredDocument,
  type SubmittedDocument,
  type ChecklistIssue,
  type ChecklistIssueCode,
  type ChecklistResult,
  type DocumentVerificationStatus,
  type FileScanStatus,
} from './domain/kyc-checklist'

export {
  listApplications,
  applicationStatusCounts,
  findApplication,
  applicationDocuments,
  applicationHistory,
  applicationMessages,
  findApplicationByReference,
  type ApplicationListRow,
  type ApplicationDetail,
  type ApplicationDocumentRow,
  type StatusHistoryRow,
  type ApplicationMessageRow,
  type PublicApplicationStatus,
} from './application/application.query'

export {
  loadApplicationAcknowledgementSnapshot,
  type ApplicationAcknowledgementSnapshot,
  type ApplicationAttachedDocument,
} from './application/application-print-snapshot'

export {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  applicationStateMachine,
  isDecided,
  type ApplicationStatus,
} from './domain/application-status'

export {
  startReview,
  attachApplicationDocument,
  verifyApplicationDocument,
  requestApplicationInfo,
  postApplicationMessage,
  rejectApplication,
  approveApplication,
  type AttachDocumentInput,
  type RequestInfoInput,
  type PostMessageInput,
  type RejectApplicationInput,
  type ApproveApplicationResult,
} from './application/review-application'

/**
 * The public, unauthenticated entry point.
 *
 * These run on a SANCTIONED service-role path — an applicant has no JWT and `anon` holds no
 * grants on customer_application, so nothing else can reach it. The implementation is
 * confined to infrastructure/system/, which is the only place scripts/guard-service-role.ts
 * permits it, and each function touches one application by reference and returns a narrow
 * projection. See docs/adr/0013-supabase-as-platform.md.
 */
export {
  submitPublicApplication,
  lookupApplicationStatus,
  recentSubmissionCount,
  publicFormOptions,
  publicKycRequirements,
  generateApplicationReference,
  publicApplicationMessages,
  publicApplicationDocuments,
  publicApplicationDetails,
  recentReplyCount,
  submitApplicantReply,
  type SubmitApplicationInput,
  type PublicStatus,
  type PublicFormOptions,
  type PublicKycRequirement,
  type PublicApplicationMessageRow,
  type PublicApplicationDocumentRow,
  type PublicApplicationDetails,
  type ApplicantReplyInput,
} from './infrastructure/system/public-application.repository'
