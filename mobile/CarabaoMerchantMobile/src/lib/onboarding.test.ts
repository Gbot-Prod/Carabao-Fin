// S17: the onboarding rules (src/lib/onboarding.ts), case for case from the web
// merchant/onboarding/page.tsx. `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiMerchantApplication } from './api.ts';
import {
  addressErrorsOf,
  birthDateError,
  formatBirthDate,
  buildPayload,
  businessPayload,
  contactState,
  documentError,
  emailSendProblem,
  firstInvalidStep,
  firstStepWithProblem,
  formatRegNum,
  formatRSBSA,
  formatTIN,
  formFromApplication,
  formFromProfile,
  fullPhoneNumber,
  INITIAL_FORM,
  keepOtherSteps,
  MESSAGES,
  NO_PROOF,
  payloadDocuments,
  phoneSendProblem,
  placeServerErrors,
  progressText,
  sortDays,
  stepOfField,
  STEPS,
  toggleDay,
  selfieError,
  validateStep,
  type ContactProof,
  type OnboardingDocument,
  type OnboardingDocuments,
  type OnboardingForm,
} from './onboarding.ts';

const PDF: OnboardingDocument = { uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 1000 };
const SELFIE: OnboardingDocument = { uri: 'file:///s.jpg', name: 's.jpg', mimeType: 'image/jpeg', size: 1000 };
const DOCS: OnboardingDocuments = { rsbsa: PDF, govId: PDF, birCert: PDF, selfie: SELFIE };

/** A step 1 that passes: address with a confirmed pin, the account's own email and number. */
const OPS_OK: OnboardingForm = {
  ...INITIAL_FORM,
  merchant_name: 'Carabao Fresh Farm',
  location: {
    region: 'Region III (Central Luzon)',
    province: 'Bulacan',
    city: 'City of Malolos',
    barangay: 'Bulihan',
    postal_code: '3000',
    street: '123 Rizal St.',
    latitude: 14.84,
    longitude: 120.81,
    pin_confirmed: true,
  },
  contact_email: 'Farm@Example.com ',
  contact_number: '917 123 4567',
};
const OWN: ContactProof = { ...NO_PROOF, accountPhone: '+639171234567', accountEmail: 'farm@example.com' };

test('two steps, ops then legal, with the web progress pill', () => {
  assert.deepEqual(STEPS.map((s) => s.id), ['ops', 'legal']);
  assert.equal(progressText(0), '1 / 2');
  assert.equal(progressText(1), '2 / 2');
});

test('step 1 passes with the account\'s own email and number', () => {
  assert.deepEqual(validateStep('ops', OPS_OK, OWN), {});
  const c = contactState(OPS_OK, OWN);
  assert.equal(c.isAccountEmail, true);
  assert.equal(c.isAccountPhone, true);
});

test('step 1 messages are the web ones', () => {
  const empty = validateStep('ops', { ...INITIAL_FORM, available_days: [] }, NO_PROOF);
  assert.equal(empty.merchant_name, MESSAGES.merchantNameRequired);
  assert.equal(empty.address, 'Enter your street / house no.');
  assert.equal(empty.region, 'Select your region.');
  assert.equal(empty.postal_code, 'Postal code is required.');
  assert.equal(empty.pin, 'Place your pin on the map at your gate or door.');
  assert.equal(empty.available_days, 'Select at least one available day.');
  assert.equal(empty.contact_email, 'Contact email is required.');
  assert.equal(empty.contact_number, 'Verify your contact number first.');

  const short = validateStep('ops', { ...OPS_OK, merchant_name: ' ab ' }, OWN);
  assert.equal(short.merchant_name, 'Merchant name must be at least 3 characters.');

  const unconfirmed = validateStep('ops', { ...OPS_OK, location: { ...OPS_OK.location, pin_confirmed: false } }, OWN);
  assert.equal(unconfirmed.pin, 'Move the pin to your gate or door, or tap “This pin is correct”.');

  const other = validateStep('ops', { ...OPS_OK, contact_email: 'new@farm.com' }, OWN);
  assert.equal(other.contact_email, 'Verify your contact email first.');
});

test('a code token proves a value that is not the account\'s', () => {
  const form = { ...OPS_OK, contact_email: 'new@farm.com', contact_number: '918 765 4321' };
  const proof = { ...OWN, emailToken: 'e', phoneToken: 'p' };
  assert.deepEqual(validateStep('ops', form, proof), {});
  const payload = buildPayload({ ...form, submit_mode: 'later', seller_type: 'individual_farmer' }, proof)!;
  assert.equal(payload.email_verification_token, 'e');
  assert.equal(payload.phone_verification_token, 'p');
  // The account's own values send empty tokens.
  const own = buildPayload({ ...OPS_OK, submit_mode: 'later', seller_type: 'individual_farmer' }, OWN)!;
  assert.equal(own.email_verification_token, '');
  assert.equal(own.phone_verification_token, '');
});

test('the send checks before a code goes out', () => {
  assert.equal(emailSendProblem('you@farm.com'), null);
  assert.equal(emailSendProblem('you@farm'), 'Enter a valid email, e.g. you@farm.com.');
  assert.equal(phoneSendProblem('917 123 4567'), null);
  assert.equal(phoneSendProblem('817 123 4567'), 'Enter a Philippine mobile number, e.g. 912 345 6789.');
  assert.equal(fullPhoneNumber('917 123 4567'), '+639171234567');
});

test('step 2: submit later needs the mode and the seller type only', () => {
  assert.deepEqual(validateStep('legal', INITIAL_FORM, NO_PROOF), {
    submit_mode: MESSAGES.submitMode,
    seller_type: MESSAGES.sellerType,
  });
  assert.deepEqual(validateStep('legal', { ...INITIAL_FORM, submit_mode: 'later', seller_type: 'cooperative' }, NO_PROOF), {});
});

test('step 2 per seller type, as the web validateStep', () => {
  const now = { ...INITIAL_FORM, submit_mode: 'now' as const };
  const farmer = validateStep('legal', { ...now, seller_type: 'individual_farmer' }, NO_PROOF);
  assert.deepEqual(Object.keys(farmer).sort(), [
    'birth_date', 'first_name', 'gov_id_file', 'last_name', 'rsbsa_file', 'selfie_file', 'sex', 'small_agri_producer',
    'terms_accepted',
  ]);
  assert.equal(farmer.rsbsa_file, 'Please upload your RSBSA document (photo or PDF).');
  assert.equal(farmer.selfie_file, 'Take a selfie while you hold your government ID.');
  // A saved file or a PDF is not a camera photo.
  assert.equal(selfieError(PDF), 'The selfie must be a photo (JPG).');
  assert.equal(selfieError({ ...SELFIE, size: 11 * 1024 * 1024 }), 'The selfie must be 10MB or smaller. Take it again.');
  assert.equal(selfieError(SELFIE), null);

  const sole = validateStep('legal', { ...now, seller_type: 'sole_proprietor' }, NO_PROOF, DOCS);
  assert.equal(sole.registration_number, 'DTI number is required.');
  assert.equal(sole.trade_name, 'Business / trade name is required.');
  assert.equal(sole.tin, 'TIN is required.');
  assert.equal(sole.vat_status, 'Choose your VAT registration status.');

  const corp = validateStep('legal', { ...now, seller_type: 'corporation' }, NO_PROOF);
  assert.equal(corp.registration_number, 'SEC number is required.');
  assert.equal(corp.company_name, 'Company registered name is required.');
  assert.equal(corp.rep_last_name, "Representative's last name is required.");
  assert.equal(corp.bir_cert_file, 'Please upload your BIR Certificate of Registration (Form 2303) (photo or PDF).');
  assert.equal(corp.last_name, undefined);

  const coop = validateStep('legal', { ...now, seller_type: 'cooperative' }, NO_PROOF, DOCS);
  assert.equal(coop.company_name, 'Cooperative registered name is required.');
  assert.equal(coop.registration_number, 'CDA number is required.');
  assert.equal(coop.trade_name, undefined);

  const badTin = validateStep('legal', { ...now, seller_type: 'individual_farmer', tin: '123-456' }, NO_PROOF, DOCS);
  assert.equal(badTin.tin, MESSAGES.tinFormat);
});

test('documents: missing, wrong type, too big', () => {
  assert.equal(documentError(null, 'government ID'), 'Please upload your government ID (photo or PDF).');
  assert.equal(
    documentError({ ...PDF, mimeType: 'text/plain' }, 'government ID'),
    'government ID must be a PDF or an image (PNG/JPG/WEBP).',
  );
  assert.equal(documentError({ ...PDF, size: 11 * 1024 * 1024 }, 'government ID'), 'government ID must be 10MB or smaller.');
  assert.equal(documentError(PDF, 'government ID'), null);
});

test('firstInvalidStep stops at the first step with a problem', () => {
  const hit = firstInvalidStep(INITIAL_FORM, NO_PROOF);
  assert.equal(hit?.index, 0);
  const second = firstInvalidStep(OPS_OK, OWN);
  assert.equal(second?.index, 1);
  assert.equal(firstInvalidStep({ ...OPS_OK, submit_mode: 'later', seller_type: 'corporation' }, OWN), null);
});

test('server field errors go under their field and to the first step with one', () => {
  assert.equal(stepOfField('merchant_name'), 'ops');
  assert.equal(stepOfField('phone_verification_token'), 'ops');
  assert.equal(stepOfField('tin'), 'legal');
  const { shown, unplaced } = placeServerErrors({
    tin: 'Bad TIN.',
    lat: 'Pin outside Luzon.',
    pin_confirmed: 'Confirm the pin.',
    email_verification_token: 'Code expired.',
    payload: 'Bad JSON.',
  });
  assert.deepEqual(shown, { tin: 'Bad TIN.', pin: 'Pin outside Luzon.', contact_email: 'Code expired.' });
  assert.deepEqual(unplaced, ['Bad JSON.']);
  assert.equal(firstStepWithProblem(Object.keys(shown)), 0);
  assert.equal(firstStepWithProblem(['tin']), 1);
  assert.equal(firstStepWithProblem([]), -1);
});

test('moving on keeps the server errors of later steps', () => {
  assert.deepEqual(keepOtherSteps({ merchant_name: 'x', tin: 'y' }, 'ops'), { tin: 'y' });
  assert.deepEqual(addressErrorsOf({ pin: 'p', tin: 'y', address: 'a' }), { pin: 'p', address: 'a' });
});

test('Submit later sends step 1 and the seller type only, and no files', () => {
  const form: OnboardingForm = {
    ...OPS_OK, submit_mode: 'later', seller_type: 'sole_proprietor',
    last_name: 'Dela Cruz', tin: '123-456-789-000', available_days: ['Fri', 'Mon'],
  };
  const payload = buildPayload(form, OWN)!;
  assert.deepEqual(payload, {
    submit_mode: 'later',
    seller_type: 'sole_proprietor',
    region: 'Region III (Central Luzon)',
    province: 'Bulacan',
    city: 'City of Malolos',
    barangay: 'Bulihan',
    address: '123 Rizal St.',
    postal_code: '3000',
    lat: 14.84,
    lng: 120.81,
    pin_confirmed: true,
    contact_email: 'Farm@Example.com',
    contact_number: '+63 917 123 4567',
    available_days: ['Mon', 'Fri'],
    phone_verification_token: '',
    email_verification_token: '',
    merchant_name: 'Carabao Fresh Farm',
  });
  assert.deepEqual(payloadDocuments(form, DOCS), { rsbsa: null, govId: null, birCert: null, selfie: null });
  assert.equal(buildPayload({ ...form, seller_type: null }, OWN), null);
});

test('Submit now adds the fields of the seller type only', () => {
  const base = { ...OPS_OK, submit_mode: 'now' as const, last_name: ' Cruz ', company_name: 'Co', tin: '1' };
  const farmer = businessPayload({ ...base, seller_type: 'individual_farmer' });
  assert.equal(farmer.last_name, 'Cruz');
  assert.equal(farmer.company_name, undefined);
  assert.equal(farmer.registration_number, undefined);
  assert.equal(farmer.terms_version, 'May 21, 2026');
  const coop = businessPayload({ ...base, seller_type: 'cooperative' });
  assert.equal(coop.company_name, 'Co');
  assert.equal(coop.last_name, undefined);
  assert.equal(coop.rep_last_name, undefined);
  assert.ok('vat_status' in coop);
  // The BIR form goes for registered types only.
  assert.equal(payloadDocuments({ ...base, seller_type: 'individual_farmer' }, DOCS).birCert, null);
  assert.equal(payloadDocuments({ ...base, seller_type: 'corporation' }, DOCS).birCert, PDF);
});

test('formats: TIN, registration number, RSBSA, days', () => {
  assert.equal(formatTIN('123456789000'), '123-456-789-000');
  assert.equal(formatTIN('1234567890001234567'), '123-456-789-00012');
  assert.equal(formatRegNum('cs-2019 12345!'), 'CS-201912345');
  assert.equal(formatRSBSA('rsbsa-0314abcd99'), 'RSBSA-0314-ABCD-99');
  assert.equal(formatRSBSA(''), '');
  assert.deepEqual(sortDays(['Sun', 'Mon', 'Xyz']), ['Mon', 'Sun']);
  assert.deepEqual(toggleDay(['Mon', 'Fri'], 'Wed'), ['Mon', 'Wed', 'Fri']);
  assert.deepEqual(toggleDay(['Mon', 'Fri'], 'Mon'), ['Fri']);
});

test('prefill: profile fills empty boxes; an application overrides with what was sent', () => {
  const fromProfile = formFromProfile(
    { ...INITIAL_FORM, contact_email: 'typed@farm.com' },
    { email: 'acc@farm.com', phone_number: '+639171234567', address: { address: 'Rizal', city: 'Malolos', province: 'Bulacan', postal_code: '3000' } },
  );
  assert.equal(fromProfile.contact_email, 'typed@farm.com');
  assert.equal(fromProfile.contact_number, '917 123 4567');
  assert.equal(fromProfile.location.street, 'Rizal');
  assert.equal(fromProfile.location.region, '');

  const app = {
    status: 'pending_documents', region: 'NCR', province: 'Metro Manila', city: 'Taguig', barangay: 'Fort',
    address: '1 Main', postal_code: '1634', available_days: ['Sat', 'Mon'], lat: 14.5, lng: 121.0, pin_confirmed: true,
    contact_email: 'a@b.co', contact_number: '+639181234567', seller_type: 'corporation', merchant_name: 'Shop',
    last_name: null, first_name: null, middle_name: null, suffix: 'Jr.', rep_last_name: 'Rep', rep_first_name: null,
    rep_middle_name: null, rep_suffix: 'Bad', company_name: 'Co', trade_name: null, registration_number: 'SEC1',
    vat_status: 'non_vat', small_agri_producer: null, gov_id_type: 'Unknown ID', tin: '***',
  } as unknown as ApiMerchantApplication;
  const filled = formFromApplication(app, fromProfile);
  assert.equal(filled.location.latitude, 14.5);
  assert.equal(filled.location.pin_confirmed, true);
  assert.deepEqual(filled.available_days, ['Mon', 'Sat']);
  assert.equal(filled.contact_number, '918 123 4567');
  assert.equal(filled.suffix, 'Jr.');
  assert.equal(filled.rep_suffix, '');
  assert.equal(filled.gov_id_type, 'PhilSys National ID');
  assert.equal(filled.tin, '', 'the masked TIN is entered again');
});

test('birth date: format, adult only', () => {
  const today = new Date(2026, 10, 26);
  assert.equal(formatBirthDate('19800501'), '1980-05-01');
  assert.equal(birthDateError('', today), 'Birth date is required.');
  assert.equal(birthDateError('1980-02-30', today), 'Enter the birth date on your government ID.');
  assert.equal(birthDateError('2008-11-27', today), 'You must be at least 18 years old.');
  assert.equal(birthDateError('2008-11-26', today), null);
});
