# UX browser fixture

`ux-legacy-save-v2.json` is the single input save for `tests/ux-polish-browser.mjs`.
It preserves the one track and the 18.558464637820087s record from the audited real
keyboard lap. The app performs its real V2-to-V3 migration on first load; the test
asserts that the result is writable V3 and that the original record is archived.
No digest, identity or archive ownership is rewritten by test setup.

Only the original V2 source is needed. The redundant migrated V3 save, browser
origin and Playwright storage-state envelope are omitted. Keeping only V3 while
omitting its V2 source would correctly trigger the source-conflict protection.

The JSON is test source: include it with the browser script in version control.
No files under `docs/` or environment override are required to run the test.
