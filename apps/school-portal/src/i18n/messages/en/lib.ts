export const lib = {
  paymentStatus: {
    successful: 'Successful',
    pending: 'Pending',
    failed: 'Failed',
    refunded: 'Refunded',
    disputed: 'Disputed',
    cancelled: 'Cancelled',
  },
  paymentMethod: {
    stripe: 'Card (Stripe)',
    cash: 'Cash',
    bankTransfer: 'Bank transfer',
    pix: 'Pix',
    cardTerminal: 'Card terminal',
  },
  roles: {
    student: 'Student',
    schoolOwnerManager: 'School owner',
    branchStaff: 'Branch Staff',
    instructor: 'Instructor',
    franchiseOwner: 'Franchise owner',
    guardian: 'Guardian',
  },
  instructorStatus: {
    active: 'Active',
    revoked: 'Revoked',
  },
  confirmDelete: {
    delete: 'Delete',
    failed: 'Could not delete. Please try again.',
    close: 'Close',
  },
};
