import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { Editor, EditorState, Modifier, CompositeDecorator, convertToRaw, convertFromRaw } from "draft-js";
import "draft-js/dist/Draft.css";
import "./App.css";

const TRANSLATE_BLOCK_ENTITY_TYPE = 'TRANSLATE_BLOCK_ENTITY';

const SpanEntity = (props: any) => {
  const phrase = `${props.children[0].props.text}`;
  const handleMouseEnter = () => {
    invoke('translate_into_jananese', { phrase: phrase }).then((translatedPhrase: any) => {
      props.setPhraseDetail({phrase: phrase, translatedPhrase: translatedPhrase});
    });
  };
  return <span className="translate-phrase" onMouseEnter={handleMouseEnter}>{phrase}</span>;
};

const spanEntityStrategy = (contentBlock: any, callback: any, contentState: any) => {
  contentBlock.findEntityRanges((character: any) => {
      const entityKey = character.getEntity();
      return entityKey !== null && contentState.getEntity(entityKey).getType() === TRANSLATE_BLOCK_ENTITY_TYPE;
  }, callback);
};


type EditorBlock = {
  key: string
  text: string
  height: number
  lastTranslatedText: string | null
}

function App() {
  const [fileName, setFileName] = useState('');
  const [editorEnable, setEditorEnable] = useState(false);
  const [phraseDetail, setPhraseDetail] = useState({phrase: '', translatedPhrase: ''});
  const [editorState, setEditorState] = useState(() => {
    const decorators = new CompositeDecorator([
      {
          strategy: spanEntityStrategy,
          component: (decoratorProps: any) => <SpanEntity {...decoratorProps} setPhraseDetail={setPhraseDetail} />
      }
    ]);
    return EditorState.createEmpty(decorators)
  });
  const editorRef = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState([] as EditorBlock[]);
  const [translatedMap, setTranslatedMap] = useState({} as { [key: string]: string });
  const [lastTranslatedMap, setLastTranslatedMap] = useState({} as { [key: string]: string });

  useEffect(() => {
    setEditorEnable(true);
  }, []);

  useEffect(() => {
    let heightMap: { [key: string]: number } = {};

    let elms = editorRef.current?.querySelectorAll('.public-DraftEditor-content > div > div') || [];
    for (var i = 0; i < elms.length; i++) {
      let offset_key = elms[i].getAttribute('data-offset-key');
      if ( offset_key != null) {
        let key = offset_key.split('-').shift();
        heightMap[key || ''] = elms[i].getBoundingClientRect().height;
      }
    }

    const contentState = editorState.getCurrentContent();
    const blockArray = contentState.getBlocksAsArray();
    setBlocks(blockArray.map((block) => {
      let key = block.getKey();
      let text = block.getText();
      console.log(key);
      console.log(heightMap[key]);

      return {
        key: key,
        text: text,
        height: heightMap[key],
        lastTranslatedText: lastTranslatedMap[key],
      }
    }));
  }, [editorState])

  const toggleTranslatePhrase = () => {
    console.log('toggleTranslatePhrase');
    const content = editorState.getCurrentContent();
    const selection = editorState.getSelection();

    if (!selection.isCollapsed()) {
      const startKey = selection.getStartKey();
      const startOffset = selection.getStartOffset();
      const blockWithEntityAtStart = content.getBlockForKey(startKey);
      const entityKeyAtStart = blockWithEntityAtStart.getEntityAt(startOffset);

      // 既にエンティティが適用されているか確認
      const alreadyHasEntity = entityKeyAtStart && content.getEntity(entityKeyAtStart).getType() === TRANSLATE_BLOCK_ENTITY_TYPE;

      let newContent;

      if (alreadyHasEntity) {
        // エンティティを取り除く
        newContent = Modifier.applyEntity(content, selection, null);
      } else {
        // エンティティを適用する
        const contentWithEntity = content.createEntity(TRANSLATE_BLOCK_ENTITY_TYPE, 'MUTABLE');
        const entityKey = contentWithEntity.getLastCreatedEntityKey();
        newContent = Modifier.applyEntity(contentWithEntity, selection, entityKey);
      }

      const newEditorState = EditorState.push(editorState, newContent, 'apply-entity');
      setEditorState(newEditorState);
    }
  };

  const save = () => {
    const contentState = editorState.getCurrentContent();
    const content = convertToRaw(contentState);
    invoke('save', { fileName: fileName, jsonStr: JSON.stringify(content) }).then(() => {
      console.log('saved');
    });
  }

  const load = () => {
    const contentState = editorState.getCurrentContent();
    const content = convertToRaw(contentState);
    const isEmpty = content.blocks.length == 0 || content.blocks.length == 1 && content.blocks[0].text == '';
    if (!isEmpty) {
      setPhraseDetail({phrase: 'Load', translatedPhrase: 'コンテンツがあるため、ロードできません'});
      return;
    }
    setPhraseDetail({phrase: 'Load', translatedPhrase: 'ロード中...'});

    invoke('load', { fileName: fileName }).then((jsonStr) => {
      const contentState = convertFromRaw(JSON.parse(`${jsonStr}`));
      const newEditorState = EditorState.push(editorState, contentState, 'apply-entity');
      setEditorState(newEditorState);
      setPhraseDetail({phrase: 'Load', translatedPhrase: 'ロード完了'});
    });
  }

  return (
    <div className="container">
      <div className="phrase-detail">
        <div>{phraseDetail.phrase}</div>
        <div>{phraseDetail.translatedPhrase}</div>
      </div>
      <div className="controll-area">
      <input className="fileNameField" value={fileName} onChange={(e) => setFileName(e.target.value)} type="text" autoComplete="off" />
        <div>
          <button onClick={toggleTranslatePhrase}>Translate</button>
          <button onClick={save}>Save</button>
          <button onClick={load}>Load</button>
        </div>
      </div>
      <div className="clearfix"></div>
      {editorEnable && (
        <div ref={editorRef} className="all-editor">
          <Editor editorState={editorState} onChange={setEditorState} />
          <div className="translate-area-root">
            <div className="translate-content">
              <div>
                {blocks.map((block) => {
                  return (
                    <div style={{height: block.height}}>
                      <span
                        className="translated-block-button"
                        onClick={() => {
                          invoke('translate_into_jananese', { phrase: block.text }).then((translatedPhrase: any) => {
                            setTranslatedMap((prev) => {
                              prev[block.key] = translatedPhrase;
                              return prev;
                            });
                            setLastTranslatedMap((prev) => {
                              prev[block.key] = block.text;
                              return prev;
                            });
                            // 配列を作り直して再描画
                            setBlocks((prev) => {
                              var next = [...prev];
                              for (let i = 0; i < next.length; i++) {
                                if (next[i].key == block.key) {
                                  next[i].lastTranslatedText = block.text;
                                  break;
                                }
                              }
                              return next;
                            });
                          });
                        }}
                      >
                        {block.lastTranslatedText == block.text ? '' : '*'}翻訳
                      </span>
                      {translatedMap[block.key]}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
