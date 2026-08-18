/**
 * M07 — Customer Master.
 *
 * A customer row is written only by the M08 approval use case, in the same transaction that
 * closes the application. There is deliberately no create path here.
 */

export {
  listCustomers,
  customerStatusCounts,
  findCustomer,
  customerContacts,
  customerBankAccounts,
  type CustomerRow,
  type CustomerDetail,
  type ContactRow,
  type CustomerBankRow,
} from './application/customer.query'

export {
  loadCustomerRegistrationSnapshot,
  type CustomerRegistrationSnapshot,
} from './application/customer-registration-print-snapshot'
