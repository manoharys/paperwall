// A node:test reporter that records each test's name and result as JSON lines.
export default async function* reporter(source) {
  for await (const event of source) {
    if ((event.type === 'test:pass' || event.type === 'test:fail') && event.data.details?.type !== 'suite') {
      yield JSON.stringify({
        name: event.data.name,
        file: event.data.file,
        pass: event.type === 'test:pass' && !event.data.skip && !event.data.todo,
        skipped: !!event.data.skip,
        ms: Math.round(event.data.details?.duration_ms || 0),
        error: event.type === 'test:fail' ? String(event.data.details?.error?.cause?.message || event.data.details?.error?.message || '').slice(0, 300) : undefined,
      }) + '\n';
    }
  }
}
