/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftEditor.react
 * @typechecks
 * @flow
 */

'use strict';

const DefaultDraftInlineStyle = require('DefaultDraftInlineStyle');
const DraftEditorCompositionHandler = require('DraftEditorCompositionHandler');
const DraftEditorContents = require('DraftEditorContents.react');
const DraftEditorDragHandler = require('DraftEditorDragHandler');
const DraftEditorEditHandler = require('DraftEditorEditHandler');
const DraftEditorPlaceholder = require('DraftEditorPlaceholder.react');
const EditorState = require('EditorState');
const React = require('React');
const ReactDOM = require('ReactDOM');
const Scroll = require('Scroll');
const Style = require('Style');
const UserAgent = require('UserAgent');

const cx = require('cx');
const emptyFunction = require('emptyFunction');
const getDefaultKeyBinding = require('getDefaultKeyBinding');
const nullthrows = require('nullthrows');
const getScrollPosition = require('getScrollPosition');

import type {BlockMap} from 'BlockMap';
import type ContentBlock from 'ContentBlock';
import type {DraftEditorModes} from 'DraftEditorModes';
import type {DraftEditorProps} from 'DraftEditorProps';
import type {DraftScrollPosition} from 'DraftScrollPosition';

const isIE = UserAgent.isBrowser('IE');

// IE does not support the `input` event on contentEditable, so we can't
// observe spellcheck behavior.
const allowSpellCheck = !isIE;

// Define a set of handler objects to correspond to each possible `mode`
// of editor behavior.
const handlerMap = {
  'edit': DraftEditorEditHandler,
  'composite': DraftEditorCompositionHandler,
  'drag': DraftEditorDragHandler,
  'cut': null,
  'render': null,
};

type DefaultProps = {
  blockRendererFn?: (block: ContentBlock) => ?Object;
  blockStyleFn?: (type: number) => string,
  keyBindingFn?: (e: SyntheticKeyboardEvent) => ?string,
  readOnly?: boolean,
  spellCheck?: boolean,
  stripPastedStyles?: boolean,
};

type State = {
  containerKey: number,
};

/**
 * `DraftEditor` is the root editor component. It composes a `contentEditable`
 * div, and provides a wide variety of useful function props for managing the
 * state of the editor. See `DraftEditorProps` for details.
 */
class DraftEditor
  extends React.Component<DefaultProps, DraftEditorProps, State> {
  state: State;

  static defaultProps = {
    blockRendererFn: emptyFunction.thatReturnsNull,
    blockStyleFn: emptyFunction.thatReturns(''),
    keyBindingFn: getDefaultKeyBinding,
    readOnly: false,
    spellCheck: false,
    stripPastedStyles: false,
  };

  _blockSelectEvents: boolean;
  _clipboard: ?BlockMap;
  _guardAgainstRender: boolean;
  _handler: ?Object;
  _dragCount: number;

  /**
   * Define proxies that can route events to the current handler.
   */
  _onBeforeInput: Function;
  _onBlur: Function;
  _onCharacterData: Function;
  _onCompositionEnd: Function;
  _onCompositionStart: Function;
  _onCopy: Function;
  _onCut: Function;
  _onDragEnd: Function;
  _onDragOver: Function;
  _onDragStart: Function;
  _onDrop: Function;
  _onInput: Function;
  _onFocus: Function;
  _onKeyDown: Function;
  _onKeyPress: Function;
  _onKeyUp: Function;
  _onMouseDown: Function;
  _onMouseUp: Function;
  _onPaste: Function;
  _onSelect: Function;

  focus: () => void;
  blur: () => void;
  setMode: (mode: DraftEditorModes) => void;
  exitCurrentMode: () => void;
  restoreEditorDOM: (scrollPosition: DraftScrollPosition) => void;
  setRenderGuard: () => void;
  removeRenderGuard: () => void;
  setClipboard: (clipboard?: BlockMap) => void;
  getClipboard: () => ?BlockMap;
  update: (editorState: EditorState) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;

  constructor(props: DraftEditorProps) {
    super(props);

    this._blockSelectEvents = false;
    this._clipboard = null;
    this._guardAgainstRender = false;
    this._handler = null;
    this._dragCount = 0;

    this._onBeforeInput = this._buildHandler('onBeforeInput');
    this._onBlur = this._buildHandler('onBlur');
    this._onCharacterData = this._buildHandler('onCharacterData');
    this._onCompositionEnd = this._buildHandler('onCompositionEnd');
    this._onCompositionStart = this._buildHandler('onCompositionStart');
    this._onCopy = this._buildHandler('onCopy');
    this._onCut = this._buildHandler('onCut');
    this._onDragEnd = this._buildHandler('onDragEnd');
    this._onDragOver = this._buildHandler('onDragOver');
    this._onDragStart = this._buildHandler('onDragStart');
    this._onDrop = this._buildHandler('onDrop');
    this._onInput = this._buildHandler('onInput');
    this._onFocus = this._buildHandler('onFocus');
    this._onKeyDown = this._buildHandler('onKeyDown');
    this._onKeyPress = this._buildHandler('onKeyPress');
    this._onKeyUp = this._buildHandler('onKeyUp');
    this._onMouseDown = this._buildHandler('onMouseDown');
    this._onMouseUp = this._buildHandler('onMouseUp');
    this._onPaste = this._buildHandler('onPaste');
    this._onSelect = this._buildHandler('onSelect');

    // Manual binding for public and internal methods.
    this.focus = this._focus.bind(this);
    this.blur = this._blur.bind(this);
    this.setMode = this._setMode.bind(this);
    this.exitCurrentMode = this._exitCurrentMode.bind(this);
    this.restoreEditorDOM = this._restoreEditorDOM.bind(this);
    this.setRenderGuard = this._setRenderGuard.bind(this);
    this.removeRenderGuard = this._removeRenderGuard.bind(this);
    this.setClipboard = this._setClipboard.bind(this);
    this.getClipboard = this._getClipboard.bind(this);
    this.update = this._update.bind(this);
    this.onDragEnter = this._onDragEnter.bind(this);
    this.onDragLeave = this._onDragLeave.bind(this);

    // See `_restoreEditorDOM()`.
    this.state = {containerKey: 0};
  }

  /**
   * Build a method that will pass the event to the specified handler method.
   * This allows us to look up the correct handler function for the current
   * editor mode, if any has been specified.
   */
  _buildHandler(eventName: string): Function {
    return (e) => {
      if (!this.props.readOnly) {
        const method = this._handler && this._handler[eventName];
        method && method.call(this, e);
      }
    };
  }

  _renderPlaceholder(): ?ReactElement {
    const content = this.props.editorState.getCurrentContent();
    const showPlaceholder = (
      this.props.placeholder &&
      !this.props.editorState.isInCompositionMode() &&
      !content.hasText()
    );

    if (showPlaceholder) {
      return (
        <DraftEditorPlaceholder
          text={nullthrows(this.props.placeholder)}
          editorState={this.props.editorState}
          textAlignment={this.props.textAlignment}
        />
      );
    }
  }

  render(): ReactElement {
    const {readOnly, textAlignment} = this.props;
    const rootClass = cx({
      'DraftEditor/root': true,
      'DraftEditor/alignLeft': textAlignment === 'left',
      'DraftEditor/alignRight': textAlignment === 'right',
      'DraftEditor/alignCenter': textAlignment === 'center',
    });
    const hasContent = this.props.editorState.getCurrentContent().hasText();

    const contentStyle = {
      outline: 'none',
      whiteSpace: 'pre-wrap',
    };

    return (
      <div className={rootClass}>
        {this._renderPlaceholder()}
        <div
          className={cx('DraftEditor/editorContainer')}
          key={'editor' + this.state.containerKey}
          ref="editorContainer">
          <div
            aria-activedescendant={
              readOnly ? null : this.props.ariaActiveDescendantID
            }
            aria-autocomplete={readOnly ? null : this.props.ariaAutoComplete}
            aria-describedby={this.props.ariaDescribedBy}
            aria-expanded={readOnly ? null : this.props.ariaExpanded}
            aria-haspopup={readOnly ? null : this.props.ariaHasPopup}
            aria-label={this.props.ariaLabel}
            aria-owns={readOnly ? null : this.props.ariaOwneeID}
            className={cx('public/DraftEditor/content')}
            contentEditable={!readOnly}
            data-testid={this.props.webDriverTestID}
            onBeforeInput={this._onBeforeInput}
            onBlur={this._onBlur}
            onCompositionEnd={this._onCompositionEnd}
            onCompositionStart={this._onCompositionStart}
            onCopy={this._onCopy}
            onCut={this._onCut}
            onDragEnd={this._onDragEnd}
            onDragEnter={this.onDragEnter}
            onDragLeave={this.onDragLeave}
            onDragOver={this._onDragOver}
            onDragStart={this._onDragStart}
            onDrop={this._onDrop}
            onFocus={this._onFocus}
            onInput={this._onInput}
            onKeyDown={this._onKeyDown}
            onKeyPress={this._onKeyPress}
            onKeyUp={this._onKeyUp}
            onMouseUp={this._onMouseUp}
            onPaste={this._onPaste}
            onSelect={this._onSelect}
            ref="editor"
            role={readOnly ? null : (this.props.role || 'textbox')}
            spellCheck={allowSpellCheck && this.props.spellCheck}
            style={contentStyle}
            tabIndex={this.props.tabIndex}
            title={hasContent ? null : this.props.placeholder}>
            <DraftEditorContents
              blockRendererFn={nullthrows(this.props.blockRendererFn)}
              blockStyleFn={nullthrows(this.props.blockStyleFn)}
              customStyleMap={
                {...DefaultDraftInlineStyle, ...this.props.customStyleMap}
              }
              editorState={this.props.editorState}
            />
          </div>
        </div>
      </div>
    );
  }

  componentDidMount(): void {
    this.setMode('edit');

    /**
     * IE has a hardcoded "feature" that attempts to convert link text into
     * anchors in contentEditable DOM. This breaks the editor's expectations of
     * the DOM, and control is lost. Disable it to make IE behave.
     * See: http://blogs.msdn.com/b/ieinternals/archive/2010/09/15/
     * ie9-beta-minor-change-list.aspx
     */
    if (isIE) {
      document.execCommand('AutoUrlDetect', false, false);
    }
  }

  /**
   * Prevent selection events from affecting the current editor state. This
   * is mostly intended to defend against IE, which fires off `selectionchange`
   * events regardless of whether the selection is set via the browser or
   * programmatically. We only care about selection events that occur because
   * of browser interaction, not re-renders and forced selections.
   */
  componentWillUpdate(): void {
    this._blockSelectEvents = true;
  }

  componentDidUpdate(): void {
    this._blockSelectEvents = false;
  }

  /**
   * Used via `this.focus()`.
   *
   * Force focus back onto the editor node.
   *
   * Forcing focus causes the browser to scroll to the top of the editor, which
   * may be undesirable when the editor is taller than the viewport. To solve
   * this, either use a specified scroll position (in cases like `cut` behavior
   * where it should be restored to a known position) or store the current
   * scroll state and put it back in place after focus has been forced.
   */
  _focus(scrollPosition?: DraftScrollPosition): void {
    const {editorState} = this.props;
    const alreadyHasFocus = editorState.getSelection().getHasFocus();
    const editorNode = ReactDOM.findDOMNode(this.refs.editor);

    const scrollParent = Style.getScrollParent(editorNode);
    const {x, y} = scrollPosition || getScrollPosition(scrollParent);

    editorNode.focus();
    if (scrollParent === window) {
      window.scrollTo(x, y);
    } else {
      Scroll.setTop(scrollParent, y);
    }

    // On Chrome and Safari, calling focus on contenteditable focuses the
    // cursor at the first character. This is something you don't expect when
    // you're clicking on an input element but not directly on a character.
    // Put the cursor back where it was before the blur.
    if (!alreadyHasFocus) {
      this.update(
        EditorState.forceSelection(
          editorState,
          editorState.getSelection()
        )
      );
    }
  }

  _blur(): void {
    ReactDOM.findDOMNode(this.refs.editor).blur();
  }

  /**
   * Used via `this.setMode(...)`.
   *
   * Set the behavior mode for the editor component. This switches the current
   * handler module to ensure that DOM events are managed appropriately for
   * the active mode.
   */
  _setMode(mode: DraftEditorModes): void {
    this._handler = handlerMap[mode];
  }

  _exitCurrentMode(): void {
    this.setMode('edit');
  }

  /**
   * Used via `this.restoreEditorDOM()`.
   *
   * Force a complete re-render of the editor based on the current EditorState.
   * This is useful when we know we are going to lose control of the DOM
   * state (cut command, IME) and we want to make sure that reconciliation
   * occurs on a version of the DOM that is synchronized with our EditorState.
   */
  _restoreEditorDOM(scrollPosition?: DraftScrollPosition): void {
    this.setState({containerKey: this.state.containerKey + 1}, () => {
      this._focus(scrollPosition);
    });
  }

  /**
   * Guard against rendering. Intended for use when we need to manually
   * reset editor contents, to ensure that no outside influences lead to
   * React reconciliation when we are in an uncertain state.
   */
  _setRenderGuard(): void {
    this._guardAgainstRender = true;
  }

  _removeRenderGuard(): void {
    this._guardAgainstRender = false;
  }

  /**
   * Used via `this.setClipboard(...)`.
   *
   * Set the clipboard state for a cut/copy event.
   */
  _setClipboard(clipboard: ?BlockMap): void {
    this._clipboard = clipboard;
  }

  /**
   * Used via `this.getClipboard()`.
   *
   * Retrieve the clipboard state for a cut/copy event.
   */
  _getClipboard(): ?BlockMap {
    return this._clipboard;
  }

  /**
   * Used via `this.update(...)`.
   *
   * Propagate a new `EditorState` object to higher-level components. This is
   * the method by which event handlers inform the `DraftEditor` component of
   * state changes. A component that composes a `DraftEditor` **must** provide
   * an `onChange` prop to receive state updates passed along from this
   * function.
   */
  _update(editorState: EditorState): void {
    this.props.onChange(editorState);
  }

  /**
   * Used in conjunction with `_onDragLeave()`, by counting the number of times
   * a dragged element enters and leaves the editor (or any of its children),
   * to determine when the dragged element absolutely leaves the editor.
   */
  _onDragEnter(): void {
    this._dragCount++;
  }

  /**
   * See `_onDragEnter()`.
   */
  _onDragLeave(): void {
    this._dragCount--;
    if (this._dragCount === 0) {
      this.exitCurrentMode();
    }
  }
}

module.exports = DraftEditor;
