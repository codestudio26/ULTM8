/**
 * The late-cancellation fee for one Booking (Decisions 234, 381): the Class's
 * own cancellation charge when it has one, else the charge on the plan the
 * Booking used. A Class whose charge is set to 0 charges nothing, without
 * falling back to the plan. Returns null when nothing is charged. One fee per
 * Booking, never both.
 */
export function lateCancellationFee(classCharge: number | null, planCharge: number | null): number | null {
  const fee = classCharge !== null ? classCharge : planCharge;
  return fee !== null && fee > 0 ? fee : null;
}
