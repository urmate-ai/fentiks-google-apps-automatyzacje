const Vertex = require('../GoogleScript/04_vertex');

describe('Vertex.buildImportPayload', () => {
  it('parsuje JSONL do entries i dołącza driveId', () => {
    const documents = [
      {
        id: 'file-1',
        content: '{"a":1}\n{"b":2}',
      },
    ];

    const payload = Vertex.buildImportPayload(documents);
    expect(payload).toEqual({
      inlineSource: {
        documents: [
          {
            id: 'file-1',
            content: {
              structData: {
                driveId: 'file-1',
                entries: [{ a: 1 }, { b: 2 }],
              },
            },
          },
        ],
      },
    });
  });

  it('oznacza niepoprawne linie w JSONL jako raw z błędem parsowania', () => {
    const documents = [
      {
        id: 'file-2',
        content: '{"ok":true}\nnot-json',
      },
    ];

    const payload = Vertex.buildImportPayload(documents);
    expect(payload.inlineSource.documents[0].content.structData.entries).toEqual([
      { ok: true },
      expect.objectContaining({ raw: 'not-json', parseError: expect.any(String) }),
    ]);
  });

  it('obsługuje pustą treść jako pustą listę entries', () => {
    const documents = [
      { id: 'file-3', content: '' },
    ];

    const payload = Vertex.buildImportPayload(documents);
    expect(payload.inlineSource.documents[0].content.structData.entries).toEqual([]);
  });
});
