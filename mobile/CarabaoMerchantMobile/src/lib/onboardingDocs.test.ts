// S18: the onboarding document and step-2 helpers (src/lib/onboarding.ts) and the status view
// (src/lib/application.ts). `npm test`.
/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyLimitMessage,
  bodyLimitProblem,
  documentError,
  documentMeta,
  documentMimeType,
  documentsBytes,
  documentsIntro,
  govIdLabel,
  initialStepIndex,
  NO_DOCUMENTS,
  pickedDocument,
  STEPS,
  submitLabel,
} from './onboarding.ts';
import { applicationView, APPLICATION_TO_VERIFICATION, BUSINESS_STEP_PATH, showStatusFirst } from './application.ts';
import { ONBOARDING_BODY_LIMIT_BYTES } from './uploads.ts';

const MB = 1024 * 1024;

test('documentMimeType keeps the picker type, else reads the name', () => {
  assert.equal(documentMimeType('a.bin', 'application/pdf'), 'application/pdf');
  assert.equal(documentMimeType('scan.PDF', null), 'application/pdf');
  assert.equal(documentMimeType('id.jpeg', 'application/octet-stream'), 'image/jpeg');
  assert.equal(documentMimeType('id.webp', ''), 'image/webp');
  assert.equal(documentMimeType('notes.docx', null), null);
  assert.equal(documentMimeType('notes.docx', 'application/msword'), 'application/msword');
});

test('pickedDocument fills a missing name and size; the S2 check refuses bad files', () => {
  const doc = pickedDocument({ uri: 'file:///cache/ID%201.png?x=1', name: null, mimeType: null, size: undefined });
  assert.equal(doc.name, 'ID%201.png');
  assert.equal(doc.mimeType, 'image/png');
  assert.equal(doc.size, null);
  assert.equal(documentError(doc, 'government ID'), null);

  const big = pickedDocument({ uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 11 * MB });
  assert.equal(documentError(big, 'RSBSA document'), 'RSBSA document must be 10MB or smaller.');
  const word = pickedDocument({ uri: 'file:///a.docx', name: 'a.docx', mimeType: null, size: 10 });
  assert.equal(documentError(word, 'government ID'), 'government ID must be a PDF or an image (PNG/JPG/WEBP).');
  assert.equal(documentError(null, 'RSBSA document'), 'Please upload your RSBSA document (photo or PDF).');
});

test('documentMeta is the web card line', () => {
  assert.equal(documentMeta({ uri: 'u', name: 'a.pdf', mimeType: 'application/pdf', size: 2048 }), 'PDF · 2 KB');
  assert.equal(documentMeta({ uri: 'u', name: 'a.png', mimeType: 'image/png', size: null }), 'PNG');
});

test('the body limit is checked before the upload, with the backend words', () => {
  assert.equal(bodyLimitMessage(ONBOARDING_BODY_LIMIT_BYTES), 'Request body must be under 42 MB');
  const tenMb = { uri: 'u', name: 'a.pdf', mimeType: 'application/pdf', size: 10 * MB };
  const three = { rsbsa: tenMb, govId: tenMb, birCert: tenMb };
  assert.equal(documentsBytes(three), 30 * MB);
  assert.equal(bodyLimitProblem(three, ONBOARDING_BODY_LIMIT_BYTES), null);
  assert.equal(bodyLimitProblem(NO_DOCUMENTS, ONBOARDING_BODY_LIMIT_BYTES), null);
  assert.equal(bodyLimitProblem(three, 30 * MB), 'Request body must be under 30 MB');
});

test('step 2 words: ID label, intro, submit button', () => {
  assert.equal(govIdLabel('corporation'), "Authorized representative's government ID");
  assert.equal(govIdLabel('individual_farmer'), 'Government ID');
  assert.ok(documentsIntro('corporation').endsWith('government ID of your authorized representative.'));
  assert.ok(documentsIntro('cooperative').endsWith('one valid government ID.'));
  assert.equal(submitLabel(true, false), 'Saving…');
  assert.equal(submitLabel(false, true), 'Save and finish later');
  assert.equal(submitLabel(false, false), 'Submit');
});

test('?step=business opens the legal step; anything else the first', () => {
  const legal = STEPS.findIndex((s) => s.id === 'legal');
  assert.equal(initialStepIndex('business'), legal);
  assert.equal(initialStepIndex(['business']), legal);
  assert.equal(initialStepIndex(undefined), 0);
  assert.equal(initialStepIndex('ops'), 0);
});

test('status first only when an application exists and the link does not ask for the form', () => {
  assert.equal(showStatusFirst(null, undefined), false);
  assert.equal(showStatusFirst({ status: 'submitted' }, undefined), true);
  assert.equal(showStatusFirst({ status: 'clarification' }, 'business'), false);
});

test('applicationView per status: titles, the edit action, the admin notes', () => {
  const saved = applicationView({ status: 'pending_documents', admin_note: 'ignored' })!;
  assert.equal(saved.title, 'Application saved');
  assert.equal(saved.step.action?.path, BUSINESS_STEP_PATH);
  assert.equal(saved.note, null);

  const submitted = applicationView({ status: 'submitted', admin_note: null })!;
  assert.equal(submitted.title, 'Application submitted');
  assert.equal(submitted.step.action, undefined);
  assert.ok(submitted.intro?.startsWith('Your application is now set for review.'));

  for (const status of ['clarification', 'rejected']) {
    const v = applicationView({ status, admin_note: '  Upload a clearer ID.  ' })!;
    assert.equal(v.status, 'needs_changes');
    assert.equal(v.note, 'Upload a clearer ID.');
    assert.equal(v.step.action?.label, 'Review and resubmit');
  }
  assert.equal(applicationView({ status: 'clarification', admin_note: '   ' })!.note, null);

  const approved = applicationView({ status: 'approved', admin_note: 'x' })!;
  assert.equal(approved.status, 'verified');
  assert.equal(approved.note, null);
  assert.equal(approved.step.action?.label, 'Go to Shop');

  assert.equal(applicationView({ status: 'suspended', admin_note: null })!.step.action, undefined);
  assert.equal(applicationView({ status: 'something_new', admin_note: null }), null);
  assert.equal(Object.keys(APPLICATION_TO_VERIFICATION).length, 6);
});
