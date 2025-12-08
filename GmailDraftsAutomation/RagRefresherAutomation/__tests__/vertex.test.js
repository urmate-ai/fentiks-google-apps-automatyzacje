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
              mimeType: 'text/plain',
              rawBytes: expect.any(String),
            },
            structData: {
              driveId: 'file-1',
              entries: [{ a: 1 }, { b: 2 }],
            },
          },
        ],
      },
    });
    // Verify that rawBytes is base64 encoded content
    const contentText = Buffer.from(payload.inlineSource.documents[0].content.rawBytes, 'base64').toString('utf-8');
    expect(contentText).toContain('{"a":1}');
    expect(contentText).toContain('{"b":2}');
  });

  it('oznacza niepoprawne linie w JSONL jako raw z błędem parsowania', () => {
    const documents = [
      {
        id: 'file-2',
        content: '{"ok":true}\nnot-json',
      },
    ];

    const payload = Vertex.buildImportPayload(documents);
    expect(payload.inlineSource.documents[0].structData.entries).toEqual([
      { ok: true },
      expect.objectContaining({ raw: 'not-json', parseError: expect.any(String) }),
    ]);
    // Verify that content field is present with base64 encoded text
    expect(payload.inlineSource.documents[0].content).toEqual({
      mimeType: 'text/plain',
      rawBytes: expect.any(String),
    });
  });

  it('obsługuje pustą treść jako pustą listę entries', () => {
    const documents = [
      { id: 'file-3', content: '' },
    ];

    const payload = Vertex.buildImportPayload(documents);
    expect(payload.inlineSource.documents[0].structData.entries).toEqual([]);
  });
});
