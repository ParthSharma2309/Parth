import fs from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';
import { getAdminFirestore, getAdminAuth } from '../server/lib/firebaseAdmin.js';
import { getSupabaseAdminClient, getSupabaseBucket, isSupabaseConfigured } from '../server/lib/supabaseAdmin.js';

function createMinimalValidPdf(title: string, text: string): Buffer {
  const content = `BT /F1 12 Tf 50 700 Td (${title}) Tj 0 -20 Td (${text}) Tj ET`;
  const streamLen = Buffer.byteLength(content, 'utf8');

  const pdf = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${streamLen} >>`,
    'stream',
    content,
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000227 00000 n ',
    '0000000300 00000 n ',
    'trailer',
    '<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '380',
    '%%EOF',
  ].join('\n');

  return Buffer.from(pdf, 'utf8');
}

async function getLiveUserToken(uid: string): Promise<string> {
  const appletConfig = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
  const auth = getAdminAuth();
  if (!auth) throw new Error('Firebase Admin Auth not initialized');

  const customToken = await auth.createCustomToken(uid);
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${appletConfig.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );

  const data: any = await resp.json();
  if (!data.idToken) {
    throw new Error(`Failed to exchange custom token for idToken: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

async function run() {
  console.log('================================================================');
  console.log('  DOCUMIND REAL SUPABASE STORAGE & FIRESTORE VERIFICATION TEST  ');
  console.log('================================================================\n');

  const userEmail = 'sharmaparth23092007@gmail.com';
  const uid = 'wgGyyP49DnPbcdCPEBtrUFhGZtF3';
  const bucketName = getSupabaseBucket();

  console.log('[Setup] Target User:', { uid, email: userEmail });
  console.log('[Setup] Supabase Configured:', isSupabaseConfigured(), 'Bucket:', bucketName);

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase Storage is NOT configured in environment.');
  }

  const supabase = getSupabaseAdminClient();
  const firestore = getAdminFirestore();
  if (!firestore) throw new Error('Firestore is NOT configured in environment.');

  // Pre-test: Verify bucket accessibility and check private status
  const { data: bucketInfo, error: bucketErr } = await supabase.storage.getBucket(bucketName);
  if (bucketErr) {
    throw new Error(`Cannot access Supabase bucket "${bucketName}": ${bucketErr.message}`);
  }
  console.log('[Setup] Supabase bucket verified:', {
    name: bucketInfo.name,
    public: bucketInfo.public, // Must be false
  });
  if (bucketInfo.public) {
    console.warn('WARNING: Supabase bucket is public! It should be private.');
  } else {
    console.log('[Security] Verified bucket is strictly PRIVATE.');
  }

  // Pre-test: Record pre-existing document IDs in Firestore
  const preDocsSnap = await firestore.collection(`users/${uid}/documents`).get();
  const preExistingDocIds = new Set<string>();
  preDocsSnap.forEach((doc) => preExistingDocIds.add(doc.id));
  console.log(`[Setup] Pre-existing user documents count: ${preExistingDocIds.size}`);

  // Exchange a real Firebase ID token for User Session A
  console.log('\n[Auth] Obtaining real Firebase ID token for Session A...');
  const sessionAToken = await getLiveUserToken(uid);
  console.log('[Auth] Session A token received successfully (length:', sessionAToken.length, ')');

  // -------------------------------------------------------------
  // TEST 1: ACTUAL UPLOAD
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('  TEST 1: ACTUAL UPLOAD PIPELINE VERIFICATION                ');
  console.log('=============================================================');

  const timestamp = Date.now();
  const testFileName = `test_quantum_research_${timestamp}.pdf`;
  const testPdfContent = `DocuMind Quantum Verification Test Content ${timestamp}`;
  const testPdfBuffer = createMinimalValidPdf('Quantum Persistence Verification', testPdfContent);

  console.log(`[Test 1.1] Generated unique test PDF "${testFileName}" (size: ${testPdfBuffer.length} bytes)`);

  const form = new FormData();
  form.append('file', testPdfBuffer, {
    filename: testFileName,
    contentType: 'application/pdf',
  });
  form.append('collectionId', 'col_verification_test');

  const uploadUrl = 'http://localhost:3000/api/documents/upload';
  console.log(`[Test 1.2] POST ${uploadUrl} with Authorization: Bearer <SessionAToken>...`);

  const uploadStart = Date.now();
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${sessionAToken}`,
      ...form.getHeaders(),
    },
    body: form as any,
  });
  const uploadDuration = Date.now() - uploadStart;

  console.log(`[Test 1.3] Upload HTTP Status: ${uploadRes.status} (${uploadDuration}ms)`);
  const uploadData: any = await uploadRes.json();
  console.log('[Test 1.3] Upload Response Body:', JSON.stringify(uploadData, null, 2));

  if (uploadRes.status !== 201 || !uploadData.success || !uploadData.document) {
    throw new Error(`Upload failed! HTTP ${uploadRes.status}: ${JSON.stringify(uploadData)}`);
  }

  const uploadedDoc = uploadData.document;
  const docId = uploadedDoc.id;
  const storagePath = uploadedDoc.storagePath;

  console.log(`[Test 1.4] Server returned Document ID: ${docId}`);
  console.log(`[Test 1.4] Server returned Storage Path: ${storagePath}`);
  console.log(`[Test 1.4] Server returned Storage Bucket: ${uploadedDoc.storageBucket}`);

  // Direct Supabase Storage Inspection
  console.log('\n[Test 1.5] Direct inspection of Supabase Storage bucket...');
  const { data: downloadedBlob, error: downloadErr } = await supabase.storage
    .from(bucketName)
    .download(storagePath);

  if (downloadErr || !downloadedBlob) {
    throw new Error(`Object ${storagePath} NOT FOUND in Supabase Storage: ${downloadErr?.message}`);
  }
  const downloadedBuffer = Buffer.from(await downloadedBlob.arrayBuffer());
  console.log(`[Test 1.5] Object EXISTS in Supabase Storage! Size: ${downloadedBuffer.length} bytes`);
  console.log(`[Test 1.5] Byte length matches uploaded buffer: ${downloadedBuffer.length === testPdfBuffer.length}`);

  // List folder in Supabase Storage
  const folderPath = `users/${uid}/${docId}`;
  const { data: folderList, error: listErr } = await supabase.storage.from(bucketName).list(folderPath);
  console.log(`[Test 1.6] Folder list at "${folderPath}":`, folderList?.map((f) => f.name));

  // Direct Firestore Inspection
  console.log('\n[Test 1.7] Direct inspection of Firestore metadata...');
  const docSnap = await firestore.doc(`users/${uid}/documents/${docId}`).get();
  if (!docSnap.exists) {
    throw new Error(`Document metadata for ${docId} NOT FOUND in Firestore!`);
  }
  const firestoreData = docSnap.data()!;
  console.log('[Test 1.7] Firestore Document Record:', JSON.stringify(firestoreData, null, 2));
  console.log('[Test 1.7] ownerId === uid:', firestoreData.ownerId === uid);
  console.log('[Test 1.7] storagePath === returned path:', firestoreData.storagePath === storagePath);
  console.log('[Test 1.7] storageBucket === bucketName:', firestoreData.storageBucket === bucketName);

  // -------------------------------------------------------------
  // TEST 2: CROSS-DEVICE SESSION B VERIFICATION
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('  TEST 2: CROSS-DEVICE PERSISTENCE (SESSION B)               ');
  console.log('=============================================================');

  console.log('[Test 2.1] Obtaining a fresh, separate ID token for Session B (Device 2)...');
  const sessionBToken = await getLiveUserToken(uid);

  console.log('[Test 2.2] GET http://localhost:3000/api/documents with Session B token...');
  const listRes = await fetch('http://localhost:3000/api/documents', {
    headers: { Authorization: `Bearer ${sessionBToken}` },
  });
  console.log(`[Test 2.2] List HTTP Status: ${listRes.status}`);
  const listData: any = await listRes.json();
  const foundInList = listData.documents?.find((d: any) => d.id === docId);
  if (!foundInList) {
    throw new Error(`Uploaded document ${docId} NOT FOUND in Session B document list!`);
  }
  console.log('[Test 2.2] Document successfully discovered by Session B:', {
    id: foundInList.id,
    name: foundInList.name,
    storagePath: foundInList.storagePath,
    storageBucket: foundInList.storageBucket,
  });

  console.log(`\n[Test 2.3] GET http://localhost:3000/api/documents/${docId}/download-url with Session B...`);
  const downloadUrlRes = await fetch(`http://localhost:3000/api/documents/${docId}/download-url`, {
    headers: { Authorization: `Bearer ${sessionBToken}` },
  });
  console.log(`[Test 2.3] Download URL HTTP Status: ${downloadUrlRes.status}`);
  const downloadUrlData: any = await downloadUrlRes.json();
  console.log('[Test 2.3] Signed URL Response:', {
    success: downloadUrlData.success,
    hasDownloadUrl: !!downloadUrlData.downloadUrl,
    expiresInSeconds: downloadUrlData.expiresInSeconds,
  });

  if (!downloadUrlData.downloadUrl) {
    throw new Error('Failed to obtain signed download URL in Session B');
  }

  // Fetch actual file using the signed URL
  console.log('[Test 2.4] Fetching file bytes from signed URL...');
  const signedFileRes = await fetch(downloadUrlData.downloadUrl);
  console.log(`[Test 2.4] Signed URL fetch status: ${signedFileRes.status}`);
  const signedFileBuffer = Buffer.from(await signedFileRes.arrayBuffer());
  console.log(`[Test 2.4] Fetched bytes length: ${signedFileBuffer.length} (Expected: ${testPdfBuffer.length})`);
  const textMatches = signedFileBuffer.toString('utf8').includes(testPdfContent);
  console.log(`[Test 2.4] File content matches original upload: ${textMatches}`);
  if (!textMatches) {
    throw new Error('Downloaded file content does not match uploaded content!');
  }

  // -------------------------------------------------------------
  // TEST 3: ACTUAL DELETION PIPELINE
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log('  TEST 3: ACTUAL DELETION PIPELINE VERIFICATION              ');
  console.log('=============================================================');

  const deleteUrl = `http://localhost:3000/api/documents/${docId}`;
  console.log(`[Test 3.1] DELETE ${deleteUrl} with Authorization: Bearer <SessionAToken>...`);

  const deleteRes = await fetch(deleteUrl, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionAToken}` },
  });
  console.log(`[Test 3.1] Delete HTTP Status: ${deleteRes.status}`);
  const deleteData: any = await deleteRes.json();
  console.log('[Test 3.1] Delete Response Body:', JSON.stringify(deleteData, null, 2));

  if (deleteRes.status !== 200 || !deleteData.success) {
    throw new Error(`Delete failed! HTTP ${deleteRes.status}: ${JSON.stringify(deleteData)}`);
  }

  // Supabase Storage verification: file must be gone
  console.log('\n[Test 3.2] Checking Supabase Storage to confirm file was deleted...');
  const { data: deletedCheckData, error: deletedCheckErr } = await supabase.storage
    .from(bucketName)
    .download(storagePath);

  if (!deletedCheckErr && deletedCheckData) {
    throw new Error(`CRITICAL: Object ${storagePath} STILL EXISTS in Supabase Storage after deletion!`);
  }
  console.log(`[Test 3.2] Supabase Storage confirmed: Object is GONE (${deletedCheckErr?.message})`);

  // Supabase Storage verification: folder must be gone
  const { data: afterFolderList } = await supabase.storage.from(bucketName).list(folderPath);
  console.log(`[Test 3.3] Folder listing after deletion at "${folderPath}":`, afterFolderList || []);
  if (afterFolderList && afterFolderList.length > 0) {
    throw new Error(`CRITICAL: Residual files remain in ${folderPath}: ${JSON.stringify(afterFolderList)}`);
  }

  // Firestore verification: metadata must be gone
  console.log('\n[Test 3.4] Checking Firestore to confirm document metadata was deleted...');
  const afterDocSnap = await firestore.doc(`users/${uid}/documents/${docId}`).get();
  console.log(`[Test 3.4] Firestore doc exists: ${afterDocSnap.exists}`);
  if (afterDocSnap.exists) {
    throw new Error(`CRITICAL: Document ${docId} STILL EXISTS in Firestore after deletion!`);
  }
  console.log('[Test 3.4] Firestore confirmed: Document metadata is GONE.');

  // Unrelated documents verification
  console.log('\n[Test 3.5] Verifying unrelated documents remain completely untouched...');
  const postDocsSnap = await firestore.collection(`users/${uid}/documents`).get();
  const postDocIds = new Set<string>();
  postDocsSnap.forEach((doc) => postDocIds.add(doc.id));
  console.log(`[Test 3.5] Current user documents count: ${postDocIds.size}`);

  // Check that all pre-existing documents still exist
  let allUntouched = true;
  for (const preId of preExistingDocIds) {
    if (!postDocIds.has(preId)) {
      console.error(`ERROR: Pre-existing document ${preId} is missing!`);
      allUntouched = false;
    }
  }
  console.log(`[Test 3.5] All ${preExistingDocIds.size} pre-existing documents untouched: ${allUntouched}`);
  if (!allUntouched) {
    throw new Error('Unrelated documents were affected during deletion!');
  }

  console.log('\n=============================================================');
  console.log('  ALL TESTS PASSED WITH 100% EVIDENCE                       ');
  console.log('=============================================================');
}

run().catch((err) => {
  console.error('\n*** TEST RUN FAILED ***\n', err);
  process.exit(1);
});
