# Lead Import, Update, and Reassignment Guide

This guide explains which JoynoSync workflow to use and what each option changes.

## Before importing

- Use CSV or XLSX files.
- JoynoSync can find the column header even when a purchased spreadsheet has title or instruction rows above it.
- For Excel workbooks with multiple sheets, JoynoSync selects the sheet that contains the strongest lead-data match.
- Review every row marked **Needs attention** before continuing.
- An unrecognized Status value is an error. JoynoSync will not silently convert it to New.

## Add newly purchased leads

Use **Import > Add new leads**.

1. Upload the purchased CSV or XLSX file.
2. Confirm the detected fields and correct any rows that need attention.
3. Choose the owner or assignment option required for the batch.
4. Continue only when the Ready count is correct.
5. After completion, review the **Assigned** and **Skipped** lists.
6. Download the results file when IT needs a complete handoff record.

New rows use **New** when the source file has no Status. Existing matching records are not reset to New.

## Update a JoynoSync export

Use **Import > Update exported leads** only for a file previously exported from JoynoSync.

The file must keep its **Lead ID** column. JoynoSync uses that ID to update the intended record.

- Blank cells preserve the current value unless a clear-field option is selected.
- A blank Status preserves the current Status.
- An invalid Status stops that row for correction.
- Existing leads are updated; this mode does not create unrelated new records.

## Reassign leads without restarting them

1. Select the leads in the table.
2. Choose **Reassign**.
3. Select the new owner.
4. Leave **Start a new sales cycle** unchecked.
5. Confirm.

This changes the owner only. Status, call-attempt history, Last Activity, and follow-up remain unchanged.

## Reassign leads and intentionally restart them as New

Use this only when management wants the selected leads to begin a new sales cycle.

1. Select the leads in the table.
2. Choose **Reassign**.
3. Select the new owner.
4. Check **Start a new sales cycle**.
5. Confirm the warning.

JoynoSync then:

- sets Status to **New**;
- clears the current attempt counter;
- clears the current next follow-up;
- preserves the previous cycle in history;
- records who restarted the cycle and when.

This action is deliberate and separate from ordinary reassignment or file import.

## Understanding import results

After an import, JoynoSync shows two result groups:

- **Assigned**: rows that were created or updated successfully, including the assigned owner when available.
- **Skipped**: rows that were not changed, with a reason such as missing required information, invalid Status, or an existing match that the selected import mode does not update.

Download the results file for the complete row-by-row report.

## Call attempts and Status

Logging **Call no answer** counts as a real attempt and moves a New lead to Contacted. Later imports and normal owner reassignment do not return that lead to New.

Only an explicit **Start a new sales cycle** action may reset a previously worked lead to New. Completed or disqualified outcomes remain terminal unless an authorized user deliberately starts a new cycle.

## Recommended IT handoff

For each import, retain:

- the original source file;
- the selected import mode;
- the completed results download;
- the intended owner or assignment rule;
- confirmation of whether a new sales cycle was requested.

If counts do not match expectations, do not repeat the import immediately. Review the Skipped reasons and correct the source file first.
