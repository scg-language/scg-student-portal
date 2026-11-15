/* Compatibility entry: the remote demo now uses existing fixture students.
 * Set SP_DEMO_LIVE=1 and optionally pass the published base URL.
 * The local-only synthetic preview retains its separate E2E runner.
 */
require('./run_e2e_teacher_demo_live_quiz.cjs');
