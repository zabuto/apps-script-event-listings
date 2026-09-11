/**
 * The whole build, in order, for a fresh spreadsheet.
 *
 * Every numbered step is here, and every one is idempotent, so running this again on a built sheet is
 * a repair rather than a rebuild. What is *not* here is the `Tool*` set: seeding rewrites the data
 * tabs, capture writes a file to Drive, and `reportState` only reads — none of them build the sheet,
 * and one of them destroys.
 *
 * Order matters twice. The checks read the computed columns, so they come after the formulas that
 * write them; everything reads the skeleton, so that is first.
 */
function setupSteps_() {
  return [
    ['skeleton', setupSkeleton],
    ['formulas', setupFormulas],
    // The hygiene checks are formulas on a generated tab, exactly like the picker lists beside them,
    // so the build owns them: an empty check cell means "did not run" rather than "nothing to
    // report", and nothing optional may be the only thing that writes one.
    ['checks', setupChecks],
    ['dashboard', setupDashboard],
    ['document', setupDocument],
  ];
}

function setupAll() {
  const done = [];

  setupSteps_().forEach(step => {
    const [name, run] = step;
    try {
      run();                       // each step reports through its own dialog and log
      done.push(`${name}: ok`);
    } catch (err) {
      // Reported rather than swallowed, and the run stops: every step after a failed one would build
      // on whatever the failure left behind.
      done.push(`${name}: FAILED — ${err.message}`);
      Logger.log(done.join('\n'));
      throw new Error(`Stopped at "${name}".\n\n${done.join('\n')}\n\n` +
        'Fix that step and run setupAll again — every step is idempotent.');
    }
  });

  log_ = [];
  report_('=== build complete ===');
  done.forEach(line => report_(line));
  report_('');
  report_('What is left, in order:');
  report_('  1. seedSheet — only on an empty sheet. It writes the sample rows from SeedData.gs.');
  report_('  2. The bound project: open the spreadsheet → Extensions → Apps Script, copy the script');
  report_('     id from Project Settings into src/.clasp.json, then `cd src && clasp push -f`.');
  report_('  3. Paste the ids the document step printed into that project\'s Script Properties.');
  report_('  4. Reload the spreadsheet and use the menu it now has.');
  report_('  5. reportState — reads the whole sheet back and checks it.');
  notify_('Build complete', log_.join('\n'));
  return log_.join('\n');
}
