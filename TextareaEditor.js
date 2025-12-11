// TODO refactor
import marvelEmitter from '@marvelapp/react-ab-test/lib/emitter';
import { convertFromHTML } from 'draft-convert';
import {
  CompositeDecorator,
  ContentBlock,
  ContentState,
  convertFromRaw,
  convertToRaw,
  Editor,
  EditorState,
  genKey,
  getDefaultKeyBinding,
  Modifier,
  RichUtils,
  SelectionState,
} from 'draft-js';
import 'draft-js/dist/Draft.css';
import { isBlogDomain } from 'lib/helpers';
import { withRouter } from 'next/router';
import nookies from 'nookies';
import PropTypes from 'prop-types';
import { PureComponent, useMemo } from 'react';
import onClickOutside from 'react-onclickoutside';
import styled, { css } from 'styled-components';
import { withResponsiveContext } from '/imports/core/api/responsiveContext';
import intlHook from '/imports/core/api/useIntl';
import { withWindowSize } from '/imports/core/api/useWindowSize';
import { withTracking } from '/imports/core/hooks/useTracking';
import { SelectionAISvg, SpellingCheckIcon } from '/imports/core/ui/assets/SelectionAISvg';
import AlignSvgIcon from '/imports/core/ui/atoms/AlignSvgIcon';
import EducationAiSuggestion from '/imports/core/ui/atoms/EducationAiSuggestion';
import Flex from '/imports/core/ui/atoms/Flex';
import SearchBox from '/imports/core/ui/atoms/SearchBox';
import SvgIcon from '/imports/core/ui/atoms/SvgIcon';
import { isWithSpeechToTextVariant } from '/imports/experiment/SpeechToTextMobileExp';
import { SINGLE_ITEM_BLOCKS } from '/imports/generator/api/constants';
import { selectionAIOptimiseProxy } from '/imports/generator/api/openaiApi';
import RealTimeSuggestion from '/imports/generator/ui/components/RealTimeSuggestion';
import SelectionAIPopup from '/imports/generator/ui/components/SelectionAIPopup';
import TranscriptionModal from '/imports/generator/ui/components/transcription/TranscriptionModal';
import { useAISelectionStore } from '/zustand/AISelectionStore';

const INLINE_STYLES = [
  { label: 'Bold', style: 'BOLD', title: 'Bold' },
  { label: 'Italic', style: 'ITALIC', title: 'Italic' },
  { label: 'Underline', style: 'UNDERLINE', title: 'Underline' },
  { label: 'Linethrough', style: 'LINETHROUGH', title: 'Strikethrough' },
];

const BLOCK_TYPES = [
  { label: 'OL', style: 'ordered-list-item', title: 'Ordered list' },
  { label: 'UL', style: 'unordered-list-item', title: 'Unordered list' },
];

const ALIGN_TYPES = [
  { label: 'left_align', style: 'left-align', title: 'Left Align' },
  { label: 'center_align', style: 'center-align', title: 'Center Align' },
  { label: 'right_align', style: 'right-align', title: 'Right Align' },
  { label: 'justify_align', style: 'justify-align', title: 'Justify Align' },
];

const styleMap = {
  LINETHROUGH: {
    textDecoration: 'line-through',
  },
};

class HandleTip extends PureComponent {
  static propTypes = {
    selectText: PropTypes.func.isRequired,
    offsetKey: PropTypes.string.isRequired,
    children: PropTypes.node,
  };

  state = {
    blue: true,
  };

  handleClick = () => {
    if (!this.state.blue) {
      return;
    }
    this.setState({ blue: false });
    this.props.selectText();
  };

  render() {
    const { children } = this.props;
    const style = (this.state.blue && { color: '#1688fe', cursor: 'pointer' }) || {};
    return (
      <span onClick={this.handleClick} style={style}>
        {children}
      </span>
    );
  }
}
@withWindowSize
@withTracking
@withRouter
@withResponsiveContext
class TextAreaEditor extends PureComponent {
  static propTypes = {
    defaultvalue: PropTypes.string,
    selectedAISuggestion: PropTypes.string,
    isSelectionRephrasing: PropTypes.bool,
    preAiText: PropTypes.string,
    trackEvent: PropTypes.func,
    type: PropTypes.string,
    isSelectedBullet: PropTypes.bool,
    onChange: PropTypes.func,
    suggestionBlockType: PropTypes.string,
    help: PropTypes.array,
    placeholder: PropTypes.string,
    area: PropTypes.any,
    areas: PropTypes.array,
    search: PropTypes.string,
    areasLoading: PropTypes.any,
    onDataChange: PropTypes.func,
    onDataSelect: PropTypes.func,
    simpleSearch: PropTypes.bool,
    hideSearch: PropTypes.bool,
    hideSearchBar: PropTypes.bool,
    dataLoading: PropTypes.bool,
    lastJob: PropTypes.string,
    withAIButton: PropTypes.bool,
    id: PropTypes.string,
    ariaLabel: PropTypes.string,
    ariaLabelledBy: PropTypes.string,
    aiPopupEventId: PropTypes.number,
  };

  constructor(props) {
    super(props);

    let { defaultvalue: value } = this.props;
    let editorState, content;

    const decorator = new CompositeDecorator([
      {
        strategy: findLinkEntities,
        component: Link,
      },
      {
        strategy: findTipEntities,
        component: (props) => <HandleTip {...props} selectText={this.selectTip} />,
      },
    ]);

    if (!value || value === '') {
      editorState = EditorState.createEmpty(decorator);
    } else {
      try {
        content = convertFromRaw(JSON.parse(value));
        editorState = EditorState.createWithContent(content, decorator);
      } catch (error) {
        editorState = EditorState.createWithContent(ContentState.createFromText(value, decorator));
      }
    }

    this.state = {
      editorState,
      focused: false,
      linksSelected: false,
      textSelected: false,
      spellCheckEnabled: false,
      alignSection: false,
      unchanged: [],
      transcriptModalOpen: false,
      isRecordingActive: false,
      recordingBlob: null,
      recordingDuration: 0,
      newSpellCheckIsOpen: false,
      withTranscriptionIntro: false,
      showFloatingAIButton: false,
      showSelectedSuggestionPopup: false,
      floatingButtonPosition: { top: 0, left: 0 },
    };
  }

  _editor = null;
  componentDidUpdate(prevProps) {
    const {
      selectedAISuggestion,
      isSelectionRephrasing,
      preAiText,
      trackEvent,
      type,
      defaultvalue,
      isCoverLetter,
      isRemoving,
      notshowEvent,
      aiPopupEventId,
      showDescription,
    } = this.props;
    const { editorState: editorStateOld } = this.state;
    let editorState = editorStateOld;
    let obj = {
      step: type,
    };
    if (
      defaultvalue !== prevProps.defaultvalue &&
      defaultvalue &&
      !this.isDraftContentString(defaultvalue) &&
      isCoverLetter
    ) {
      this.onChange(EditorState.createWithContent(ContentState.createFromText(defaultvalue)));
    }
    if (aiPopupEventId !== prevProps.aiPopupEventId) {
      if (isSelectionRephrasing && notshowEvent) {
        trackEvent('ai_swap', obj);
      }
      if (!notshowEvent) {
        trackEvent('add_description_cta_trigger', obj);
      }
      this.updateEditorStateFromPopup(editorState, editorStateOld, selectedAISuggestion, isRemoving);
      trackEvent('ai_text_added', obj);
    }
    if (preAiText && prevProps.preAiText !== preAiText) {
      this.updateEditorStateFromPopup(editorState, editorStateOld, preAiText);
      trackEvent('pre_ai_text_selected', obj);
    }

    const transcriptionDefaultModal =
      isWithSpeechToTextVariant() && !localStorage.getItem('transcription_force_popup_open');
    if (prevProps.showDescription == false && showDescription == true && transcriptionDefaultModal) {
      localStorage.setItem('transcription_force_popup_open', 'true');
      this.setState({ transcriptModalOpen: true, withTranscriptionIntro: true });
    }
  }

  setTranscriptModalOpen = (value) => {
    this.setState({ transcriptModalOpen: value });
  };

  isDraftContentString(input) {
    try {
      const parsedInput = JSON.parse(input);
      return typeof parsedInput === 'object' && 'blocks' in parsedInput;
    } catch (e) {
      return false;
    }
  }

  changeNewSpellCheckStatus = (status) => {
    this.setState({ newSpellCheckIsOpen: status });
  };

  updateEditorStateFromPopup = (editorState, editorStateOld, selectedText, isRemoving = false) => {
    //if selection is from rephrasing, we remove all text from input first then it will replace from the selected item
    const { isSelectedBullet, isSelectionRephrasing, width } = this.props;
    const isMobilePreview = width <= 800;
    if (isSelectionRephrasing && !isRemoving) {
      editorState = EditorState.push(editorStateOld, ContentState.createFromText(''));
      this.setState({ editorState });
    }
    const selectionState = editorState.getSelection();
    const anchorKey = selectionState.getAnchorKey();
    const currentContent = editorState.getCurrentContent();
    const currentContentBlock = currentContent.getBlockForKey(anchorKey);
    const start = selectionState.getStartOffset();
    const textBeforeCurrentSelection = currentContentBlock?.getText()?.slice(0, start);
    const textAfterCurrentSelection = currentContentBlock?.getText()?.slice(start, currentContentBlock?.getLength());
    let headNewLine = '',
      endingNewLine = '';
    const bulletStart = isSelectedBullet && !isSelectionRephrasing ? '• ' : '';
    let selectionStateTarget = null;
    if (!textBeforeCurrentSelection) {
      if (textAfterCurrentSelection) {
        endingNewLine = '\n';
      }
      selectionStateTarget = selectionState;
    } else {
      headNewLine = '\n';
      selectionStateTarget = new SelectionState({
        anchorKey: anchorKey,
        anchorOffset: currentContentBlock?.getLength(),
        focusKey: anchorKey,
        focusOffset: currentContentBlock?.getLength(),
        hasFocus: !isMobilePreview,
        isBackward: false,
      });
    }

    const pastedOutput = `${headNewLine}${bulletStart}${selectedText}${endingNewLine}`;
    if (isRemoving) {
      this.RemoveSuggestion(pastedOutput, isSelectionRephrasing);
    } else {
      if (isSelectionRephrasing) {
        if (selectedText.includes('•')) {
          const textList = selectedText.split('•');
          const blockArray = [];
          for (const textPart of textList) {
            if (textPart?.trim() != '') {
              const newContentBlock = new ContentBlock({
                key: genKey(),
                type: 'unordered-list-item',
                text: textPart?.trim()?.replace(/\n\n/g, ''),
              });
              blockArray.push([newContentBlock.getKey(), newContentBlock]);
            }
          }
          this.addSuggestion(null, blockArray?.[0]?.[0], null, blockArray, editorState);
        } else {
          this.addSuggestion(selectedText, genKey(), 'unstyled', [], editorState);
        }
      } else {
        this.addSuggestion(selectedText, genKey());
      }
    }
  };

  insertBulletPoint = (rawText) => {
    this.addSuggestion(rawText, genKey());
  };

  insertParagraph = (rawText) => {
    const { editorState } = this.state;
    if (rawText.includes('•')) {
      const textList = rawText.split('•');
      const blockArray = [];
      for (const textPart of textList) {
        if (textPart?.trim() != '') {
          const newContentBlock = new ContentBlock({
            key: genKey(),
            type: 'unordered-list-item',
            text: textPart?.trim()?.replace(/\n\n/g, ''),
          });
          blockArray.push([newContentBlock.getKey(), newContentBlock]);
        }
      }
      this.addSuggestion(null, blockArray?.[0]?.[0], null, blockArray, editorState);
    } else {
      this.addSuggestion(rawText, genKey(), 'unstyled');
    }
  };

  /**
   * Inserts text (suggestions' item from “AI Suggestion Feature/Popup”) into the editor state at the specified selection position.
   *
   * @param {string} text - The text to be inserted into the editor.
   * @param {SelectionState} selectionState - The selection state indicating where the text should be inserted.
   * @param {EditorState} editorState - The current editor state.
   */
  InsertSuggestion = (text, selectionState, editorState) => {
    const pastedBlocks = ContentState.createFromText(text).blockMap;
    const newState = Modifier.replaceWithFragment(editorState.getCurrentContent(), selectionState, pastedBlocks);
    this.onChange(EditorState.push(editorState, newState, 'insert-fragment'));
    return true;
  };

  /**
   * Removes text (that are previously added through “AI Suggestion Feature/Popup”) from the editor state.
   *
   * @param {string} text - The text to be removed from the editor.
   * @param {boolean} isSelectionRephrasing - Indicates if the text is from the rephrasing section of AI suggestions. Default is set to false
   */
  RemoveSuggestion = (text, isSelectionRephrasing = false) => {
    const { editorState } = this.state;
    const selectedBlocks = ContentState.createFromText(text).blockMap;
    const contentState = editorState.getCurrentContent();
    const currentBlocks = contentState.getBlockMap();
    let updatedBlocks = currentBlocks;
    selectedBlocks.forEach((block) => {
      currentBlocks.forEach((cBlock, cKey) => {
        if (block.getText()?.includes(cBlock.getText())) {
          updatedBlocks = updatedBlocks.delete(cKey);
        }
      });
    });

    const newState = ContentState.createFromBlockArray(updatedBlocks.toArray());
    const isEmpty = newState.getBlockMap().size <= 0 || !newState.hasText();

    if (isSelectionRephrasing && isEmpty) {
      const revertedEditorState = this.undo(this.state.editorState, 2);
      const revertedPlainText = revertedEditorState?.getCurrentContent()?.getPlainText();
      const currentPlainText = editorState?.getCurrentContent()?.getPlainText();
      if (revertedPlainText !== currentPlainText) {
        return this.setState(
          (st) => ({
            editorState: revertedEditorState,
          }),
          () => {
            const revertedContent = JSON.stringify(convertToRaw(revertedEditorState.getCurrentContent()));
            this.props.onChange({ target: { value: revertedContent } });
          },
        );
      }
    }
    let newEditorState = EditorState.createWithContent(newState);
    newEditorState = EditorState.moveSelectionToEnd(newEditorState);
    this.setState(
      (st) => ({
        editorState: newEditorState,
      }),
      () => {
        const content = JSON.stringify(convertToRaw(this.state.editorState.getCurrentContent()));
        this.props.onChange({ target: { value: content } });
      },
    );
  };

  /**
   * Performs multiple undo operations on the editor state recursively.
   * @param {EditorState} editorState - The current editor state.
   * @param {number} [count=1] - The number of undo operations to perform. Default is 1 if not provided.
   * @returns {EditorState} The editor state after performing the undo operations.
   */
  undo = (editorState, count = 1) => {
    if (count <= 0) {
      return editorState;
    }
    return this.undo(EditorState.undo(editorState), count - 1);
  };

  /**
   * Performs multiple redo operations on the editor state recursively.
   * @param {EditorState} editorState - The current editor state.
   * @param {number} [count=1] - The number of redo operations to perform. Default is 1 if not provided.
   * @returns {EditorState} The editor state after performing the redo operations.
   */
  redo = (editorState, count = 1) => {
    if (count <= 0) {
      return editorState;
    }
    return this.redo(EditorState.redo(editorState), count - 1);
  };

  setEmptyUnchanged = () => {
    this.setState({ unchanged: [] });
  };

  selectTip = () => {
    const { editorState } = this.state;
    const contentState = this.state.editorState.getCurrentContent();
    const selectionState = editorState.getSelection();
    const archorKey = selectionState.getAnchorKey();
    const anchorOffset = selectionState.getAnchorOffset();
    const block = contentState.getBlockForKey(archorKey);
    if (block) {
      const text = block.getText();
      const str1 = text.substring(0, anchorOffset);
      const str2 = text.substring(anchorOffset, text.length);
      const start = str1.lastIndexOf('[');
      const end = str1.length + str2.indexOf(']') + 1;
      const selection = {
        anchorKey: archorKey,
        anchorOffset: start,
        focusKey: archorKey,
        focusOffset: end,
        isBackward: false,
        hasFocus: false,
      };
      const newSelectionState = selectionState.merge(selection);
      const newEditorState = EditorState.forceSelection(editorState, newSelectionState);
      this.setState({ editorState: newEditorState });
    }
  };

  selectText = (selection) => {
    const { editorState } = this.state;
    const selectionState = editorState.getSelection();
    const newSelectionState = selectionState.merge(selection);
    const newEditorState = EditorState.forceSelection(editorState, newSelectionState);
    this.setState({ editorState: newEditorState });
  };

  escapeHtml = (text) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  getSelectedText = (editorState) => {
    const selectionState = editorState.getSelection();
    const contentState = editorState.getCurrentContent();
    const startKey = selectionState.getStartKey();
    const endKey = selectionState.getEndKey();
    const startOffset = selectionState.getStartOffset();
    const endOffset = selectionState.getEndOffset();
    const blocks = contentState.getBlockMap();
    const blockArray = Array.from(blocks.values());

    let plainText = '';
    let htmlText = '';
    let capture = false;
    let listType = null;
    let listItems = [];
    const selectionList = [];

    const processBlock = (block, start, end) => {
      const text = block.getText();
      const type = block.getType();
      const slicedText = text.slice(start, end);
      
      if (slicedText.trim().length > 0) {
        selectionList.push({
          text: slicedText,
          'list-type':
            type === 'unordered-list-item' ? 'unorder-list' : type === 'ordered-list-item' ? 'order-list' : 'unstyled',
        });
      }

      plainText += slicedText + " || ";

      if (type === 'unordered-list-item' || type === 'ordered-list-item') {
        if (listType && listType !== type) {
          htmlText +=
            listType === 'unordered-list-item' ? `<ul>${listItems.join('')}</ul>` : `<ol>${listItems.join('')}</ol>`;
          listItems = [];
        }
        listType = type;
        listItems.push(`<li>${this.escapeHtml(slicedText)}</li>`);
      } else {
        if (listType) {
          htmlText +=
            listType === 'unordered-list-item' ? `<ul>${listItems.join('')}</ul>` : `<ol>${listItems.join('')}</ol>`;
          listType = null;
          listItems = [];
        }
        htmlText += this.escapeHtml(slicedText);
      }
    };

    for (const block of blockArray) {
      const key = block.getKey();
      const textLength = block.getLength();
      if (key === startKey) {
        capture = true;
        if (key === endKey) {
          processBlock(block, startOffset, endOffset);
          break;
        } else {
          processBlock(block, startOffset, textLength);
        }
      } else if (key === endKey) {
        if (endOffset > 0) {
          processBlock(block, 0, endOffset);
        }
        break;
      } else if (capture) {
        processBlock(block, 0, textLength);
      }
    }

    if (listType) {
      htmlText +=
        listType === 'unordered-list-item' ? `<ul>${listItems.join('')}</ul>` : `<ol>${listItems.join('')}</ol>`;
    }

    return { text: plainText.trim(), html: htmlText, selectionList };
  };

  onChange = (editorState) => {
    if (this.state.editorState !== editorState) {
      const { setSelectedValue } = useAISelectionStore.getState();
      const selectionState = editorState.getSelection();
      this.lastSelectionState = selectionState;
      const anchorKey = selectionState.getAnchorKey();
      const currentContent = editorState.getCurrentContent();
      const currentContentBlock = currentContent.getBlockForKey(anchorKey);

      const { text: aiselectedText, html: aiselectedHtml, selectionList } = this.getSelectedText(editorState);
      setSelectedValue(aiselectedText, aiselectedHtml, selectionList);

      const start = selectionState.getStartOffset();
      const end = selectionState.getEndOffset();
      const selectedText = currentContentBlock?.getText()?.slice(start, end);
      const isEmpty = !currentContent.hasText();
      const links = this.getEntities(editorState, 'LINK');
      if (isEmpty) this.setEmptyUnchanged();
      const { type } = this.props;
      const TARGET_SECTIONS = ['PROFESSIONAL_SUMMARY', 'EMPLOYMENT', 'EDUCATION', 'INTERNSHIPS'];
      const isValidSection = TARGET_SECTIONS.includes(type);

      let linksSelected = false;
      let textSelected = selectedText && selectedText !== '';
      const isMoreSelected = aiselectedText && aiselectedText?.trim().split(' ').length > 1;

      links.forEach((link) => {
        if ((start >= link.start && start <= link.end) || (end >= link.start && end <= link.end)) {
          linksSelected = true;
        }
      });

      if (this.state.editorState.getCurrentContent() !== editorState.getCurrentContent()) {
        const updatedContent = convertToRaw(editorState.getCurrentContent());
        // NOTE: Sometimes draftjs don't return json object, don't save in that case, just return
        if (typeof updatedContent !== 'object') return;
        const content = JSON.stringify(updatedContent);
        this.props.onChange({ target: { value: content } });
      }
      this.setState({
        editorState,
        linksSelected,
        textSelected,
        showFloatingAIButton: !!isMoreSelected && isValidSection,
      });
    }
  };

  handleKeyCommand = (command) => {
    const { editorState } = this.state;
    if (command === 'split-block') {
      const selectionState = editorState.getSelection();
      const contentState = editorState.getCurrentContent();
      const anchorKey = selectionState.getAnchorKey();
      const block = contentState.getBlockForKey(anchorKey);
      if (
        block.getText() === '' &&
        (block.getType() === 'ordered-list-item' || block.getType() === 'unordered-list-item')
      ) {
        this.toggleBlockType('unstyled');
        return true;
      }
    }
    const newState = RichUtils.handleKeyCommand(editorState, command);
    if (newState) {
      this.onChange(newState);
      return true;
    }
    return false;
  };

  toggleBlockType = (blockType) => {
    this.onChange(RichUtils.toggleBlockType(this.state.editorState, blockType));
  };

  toggleInlineStyle = (inlineStyle) => {
    const { editorState } = this.state;
    const currentInlineStyle = editorState.getCurrentInlineStyle();

    if (inlineStyle === 'LINETHROUGH') {
      const hasLinethrough = currentInlineStyle.has('LINETHROUGH');
      const hasStrikethrough = currentInlineStyle.has('STRIKETHROUGH');
      let newEditorState = editorState;

      if (hasLinethrough) {
        newEditorState = RichUtils.toggleInlineStyle(newEditorState, 'LINETHROUGH');
      }
      if (hasStrikethrough) {
        newEditorState = RichUtils.toggleInlineStyle(newEditorState, 'STRIKETHROUGH');
      }
      if (!hasLinethrough && !hasStrikethrough) {
        newEditorState = RichUtils.toggleInlineStyle(newEditorState, 'LINETHROUGH');
      }
      this.onChange(newEditorState);
    } else {
      this.onChange(RichUtils.toggleInlineStyle(editorState, inlineStyle));
    }
  };

  getEntities = (editorState, entityType = null) => {
    const content = editorState.getCurrentContent();
    const entities = [];
    content.getBlocksAsArray().forEach((block) => {
      let selectedEntity = null;
      block.findEntityRanges(
        (character) => {
          if (character.getEntity() !== null) {
            const entity = content.getEntity(character.getEntity());
            if (!entityType || (entityType && entity.getType() === entityType)) {
              selectedEntity = {
                entityKey: character.getEntity(),
                blockKey: block.getKey(),
                entity: content.getEntity(character.getEntity()),
              };
              return true;
            }
          }
          return false;
        },
        (start, end) => {
          entities.push({ ...selectedEntity, start, end });
        },
      );
    });
    return entities;
  };

  toggleLink = () => {
    if (this.state.linksSelected) {
      this.removeLink();
    } else {
      this.addLink();
    }
  };

  toggleSpellCheck = () => {
    this.setState(
      (prevState) => {
        return { spellCheckEnabled: !prevState.spellCheckEnabled };
      },
      () => {
        if (this.state.spellCheckEnabled) this._editor.focus();
      },
    );
  };

  activateSpellCheck = () => {
    this.setState({ spellCheckEnabled: true }, () => {
      if (this.state.spellCheckEnabled) this._editor.focus();
    });
  };

  addLink = () => {
    const url = prompt('Please enter url');
    const regExp = RegExp('^(https?://)');
    if (url !== null && url !== '') {
      const { editorState } = this.state;
      const correctUrl = regExp.test(url) ? url : `http://${url}`;
      const contentState = editorState.getCurrentContent();
      const contentStateWithEntity = contentState.createEntity('LINK', 'MUTABLE', { url: correctUrl });
      const entityKey = contentStateWithEntity.getLastCreatedEntityKey();
      const newEditorState = EditorState.set(editorState, {
        currentContent: contentStateWithEntity,
      });
      this.onChange(RichUtils.toggleLink(newEditorState, newEditorState.getSelection(), entityKey));
    }
  };

  removeLink = () => {
    const { editorState } = this.state;
    const selection = editorState.getSelection();
    if (!selection.isCollapsed()) {
      this.onChange(RichUtils.toggleLink(editorState, selection, null));
    }
  };

  onFocus = () => {
    this.setState({ focused: true });
  };

  onBlur = () => {
    this.setState({ focused: false });
  };

  getEditor = (node) => {
    this._editor = node;
  };

  getEditorRef = () => {
    return this._editor;
  };

  addSuggestion = (text, key, type = '', contentBlockArray = [], defaultEditorState = null) => {
    const editorState = EditorState.moveSelectionToEnd(defaultEditorState || this.state.editorState);
    const { width } = this.props;
    const isMobilePreview = width <= 800;
    const contentState = editorState.getCurrentContent();

    const blockMap = contentState.getBlockMap();
    let newBlockMap = blockMap;
    if (contentBlockArray.length > 0) {
      newBlockMap = newBlockMap.toSeq().concat(contentBlockArray).toOrderedMap();
    } else {
      const newBlock = new ContentBlock({
        key,
        type: type || this.props.suggestionBlockType || 'unordered-list-item',
        text,
      });
      newBlockMap = newBlockMap
        .toSeq()
        .concat([[newBlock.getKey(), newBlock]])
        .toOrderedMap();
    }
    if (newBlockMap?.first().text === '') {
      newBlockMap = newBlockMap.delete(newBlockMap?.first().key);
    }
    let newContentState;
    newContentState = contentState.merge({
      blockMap: newBlockMap,
    });
    let newEditorState = EditorState.push(editorState, newContentState, 'insert-fragment');
    newEditorState = EditorState.moveSelectionToEnd(newEditorState);
    this.setState(
      (st) => ({
        editorState: newEditorState,
        unchanged: [
          ...st.unchanged,
          ...(contentBlockArray.length > 0 ? contentBlockArray?.map((cba) => cba[0]) : [key]),
        ],
      }),
      () => {
        const content = JSON.stringify(convertToRaw(this.state.editorState.getCurrentContent()));
        this.props.onChange({ target: { value: content } });
        if (!isMobilePreview) {
          this._editor.focus();
        }
        setTimeout(() => {
          const editorContent = this._editor?.editor;
          if (editorContent) {
            editorContent.scrollTop = editorContent.scrollHeight;
          }
        }, 0);
      },
    );
  };

  removeSuggestion = (text, key) => {
    const { editorState } = this.state;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    let newBlockMap = blockMap.delete(key);
    if (newBlockMap.size === 0) {
      const newBlock = new ContentBlock({
        key: genKey(),
        type: 'unstyled',
        text: '',
      });
      newBlockMap = newBlockMap.set(newBlock.getKey(), newBlock);
    }
    let newContentState;
    newContentState = contentState.merge({
      blockMap: newBlockMap,
    });
    let newEditorState = EditorState.set(editorState, {
      currentContent: newContentState,
    });
    newEditorState = EditorState.moveSelectionToEnd(newEditorState);
    this.setState(
      (st) => ({
        editorState: newEditorState,
        unchanged: st.unchanged.filter((u) => u !== key),
      }),
      () => {
        const content = JSON.stringify(convertToRaw(this.state.editorState.getCurrentContent()));
        this.props.onChange({ target: { value: content } });
      },
    );
  };

  onHelpSelect = (phrase, id, selected) => {
    if (selected) {
      this.removeSuggestion(phrase, id);
    } else {
      this.addSuggestion(phrase, id);
    }
  };

  find = (text) => {
    const { blocks } = convertToRaw(this.state.editorState.getCurrentContent());
    return (
      blocks && blocks.length && blocks.some((block) => block.text === text && block.type === 'unordered-list-item')
    );
  };

  getSelectedValues = (values) => {
    const blocks = this.state.editorState.getCurrentContent().getBlocksAsArray();
    let result = [];
    values.forEach((value) => {
      blocks.forEach((block) => {
        if (block.getText() === value && block.getType() === 'unordered-list-item') {
          result.push(value);
        }
      });
    });
    return result;
  };

  getCurrentPhrases = () => {
    const blocks = this.state.editorState.getCurrentContent().getBlocksAsArray();
    let result = [];
    blocks.forEach((block) => {
      if (block.getText() !== '' && block.getType() === 'unordered-list-item') {
        result.push(block.getText());
      }
    });
    return result;
  };

  updateUnchanged = () => {
    const blocks = this.state.editorState.getCurrentContent().getBlocksAsArray();
    const { help } = this.props;
    let result = [];
    blocks.forEach((block) => {
      if (block.getText() !== '') {
        const index = help.findIndex((h) => h.id === block.getKey());
        if (index !== -1) {
          result.push(help[index].id);
        }
      }
    });
    this.setState((st) => ({ unchanged: st.unchanged.concat(result) }));
  };

  handleEditorChange = (editorState) => {
    this.setState({ editorState });
  };

  handlePastedText = (text, html) => {
    const { editorState } = this.state;

    if (html) {
      const newContentState = convertFromHTML({
        htmlToStyle: (nodeName, node, currentStyle) => {
          if (nodeName === 'b' || nodeName === 'strong') return currentStyle.add('BOLD');
          if (nodeName === 'i' || nodeName === 'em') return currentStyle.add('ITALIC');
          return currentStyle;
        },
        htmlToEntity: (nodeName, node, createEntity) => {
          if (nodeName === 'a') {
            return createEntity('LINK', 'MUTABLE', { url: node.href });
          }
          return null;
        },
        htmlToBlock: (nodeName, node) => {
          if (nodeName === 'ul' || nodeName === 'ol' || nodeName === 'li') return 'unordered-list-item';
          return 'unstyled';
        },
      })(html);

      const filteredBlockMap = newContentState.getBlockMap().filter((block) => block.getText().trim() !== '');
      const contentWithPastedText = Modifier.replaceWithFragment(
        editorState.getCurrentContent(),
        editorState.getSelection(),
        filteredBlockMap,
      );
      this.onChange(EditorState.push(editorState, contentWithPastedText, 'insert-fragment'));
      return true;
    }

    const pastedBlocks = ContentState.createFromText(text.trim()).blockMap;
    const newState = Modifier.replaceWithFragment(
      editorState.getCurrentContent(),
      editorState.getSelection(),
      pastedBlocks,
    );
    this.onChange(EditorState.push(editorState, newState, 'insert-fragment'));
    return true;
  };

  changeAlignSection = () => {
    this.setState({ alignSection: !this.state.alignSection });
  };

  getBlockStyle = (block) => {
    switch (block.getType()) {
      case 'left-align':
        return 'left-align';
      case 'center-align':
        return 'center-align';
      case 'right-align':
        return 'right-align';
      case 'justify-align':
        return 'justify-align';
      default:
        return null;
    }
  };

  customKeyBindingFn = (e) => {
    if (e.keyCode === 13) {
      return 'split-block';
    }
    if (e.keyCode === 9) {
      const maxDepth = 4;
      this.onChange(RichUtils.onTab(e, this.state.editorState, maxDepth));
    }
    return getDefaultKeyBinding(e);
  };

  checkClickToEdit(e) {
    const { id, dataset } = e?.target;
    const { variables, type } = this.props;
    const { editorState } = this.state;
    if (id === 'click-to-edit-button' && dataset?.editorItemId === variables?.itemId) {
      setTimeout(() => {
        const isSingleItemBlock = SINGLE_ITEM_BLOCKS.includes(type);
        const wrapperElementId = isSingleItemBlock ? type : `toggle-item-${variables?.itemId}`;
        const wrapperElement = document.getElementById(wrapperElementId);
        wrapperElement?.scrollIntoView({
          block: 'start',
        });
        this.setState({ editorState: EditorState.moveFocusToEnd(editorState) });
        setTimeout(() => {
          const editorContent = this._editor?.editor;
          if (editorContent) {
            editorContent.scrollTop = editorContent.scrollHeight;
          }
        }, 0);
      }, 0);
    }
  }

  withRealTimeSuggestion = () => {
    const { type, isStrictMobile } = this.props;
    return type === 'EMPLOYMENT' && isStrictMobile;
  };

  toggleAICTADisplay = (display) => {
    const { item } = this.props;
    const event = new CustomEvent(`ai-suggestion-cta-display-${item?.id}`, {
      detail: {
        display,
      },
    });
    window?.dispatchEvent(event);
  };

  onRecordingComplete = (blob, duration) => {
    const { trackEvent } = this.props;
    trackEvent('recording_validate_cta');
    this.setState({
      isRecordingActive: false,
      recordingBlob: blob,
      recordingDuration: duration,
      transcriptModalOpen: true,
      withTranscriptionIntro: false,
    });
  };

  onRecordingCancel = () => {
    const { trackEvent } = this.props;
    trackEvent('recording_canceled_cta');
    this.setState({
      isRecordingActive: false,
    });
  };

  handleTranscriptCTAClick = (e) => {
    e.preventDefault();
    const { trackEvent } = this.props;
    trackEvent('transcription_description_cta');
    this.setState({
      transcriptModalOpen: true,
    });
  };

  withTranscriptionFeature = () => {
    const { type } = this.props;
    const TARGET_SECTIONS = ['PROFESSIONAL_SUMMARY', 'EMPLOYMENT', 'EDUCATION'];
    return isWithSpeechToTextVariant() && TARGET_SECTIONS.includes(type);
  };

  handleFloatingButtonClick = () => {
    const { trackEvent } = this.props;
    trackEvent('selection_ai_cta_clicked');
    this.setState({ showSelectedSuggestionPopup: true });
  };

  handleSpellingCheckClick = async () => {
    const { token } = nookies.get({});
    const { trackEvent, resume, host } = this.props;
    const isBlog = isBlogDomain(host);
    this.setState({ showSelectedSuggestionPopup: true });
    trackEvent('spelling_ai_cta_clicked');

    let websiteURL = typeof window !== 'undefined' && window.location.origin;
    if (isBlog) websiteURL += '/builder';

    const { updateAIState, selectedValue } = useAISelectionStore.getState();
    updateAIState({ loading: true });

    const payload = {
      text: selectedValue,
      actionType: 'spell-checker',
      resumeId: resume?.id,
      resumeLang: resume?.settings?.language,
    };
    const resp = await selectionAIOptimiseProxy(payload, token, websiteURL);
    updateAIState({ aiOutPut: resp.text, loading: false });
  };

  handleCloseSelectionPopup = () => {
    const { resetAIState } = useAISelectionStore.getState();
    resetAIState();
    this.setState({ showSelectedSuggestionPopup: false });
  };

  handleTextSelection = () => {
    const activeAIVar = marvelEmitter.getActiveVariant('exp_ai_selection_suggestion');
    const showSelectionAIExp =
      ['ai_selection', 'ai_selection_with_spelling'].includes(activeAIVar) && this.props.width > 980;
    if (!showSelectionAIExp) return;
    const selection = window.getSelection();
    const editorWrapper = this.editorWrapper;

    if (!selection || selection.isCollapsed || !editorWrapper) {
      if (this.state.showFloatingAIButton) this.setState({ showFloatingAIButton: false });
      return;
    }

    this.lastValidSelection = this.state.editorState.getSelection();

    const range = selection.getRangeAt(0);
    const selectionRect = range.getBoundingClientRect();
    const containerRect = editorWrapper.getBoundingClientRect();
    const showSpellingCheck = activeAIVar === 'ai_selection_with_spelling' && this.props.width > 980;
    const popupWidth = showSpellingCheck ? 350 : 170;

    let relativeLeft = selectionRect.left - containerRect.left + selectionRect.width / 2 - popupWidth / 2;

    const padding = 10;
    const safeLeft = Math.min(Math.max(relativeLeft, padding), containerRect.width - popupWidth - padding);
    let relativeTop = selectionRect.top - containerRect.top + editorWrapper.scrollTop;
    let safeTop = relativeTop - 10;
    if (safeTop < padding) safeTop = relativeTop + 25;
    if (safeTop < 20) safeTop = 80;
    safeTop = Math.min(safeTop, containerRect.height - 50);

    this.setState({
      floatingButtonPosition: { top: safeTop, left: safeLeft },
    });
  };

  componentDidCatch() {
    this.forceUpdate();
  }

  componentDidMount() {
    document.addEventListener('click', this.checkClickToEdit.bind(this));
    document.addEventListener('mouseup', this.handleTextSelection);
    document.addEventListener('keyup', this.handleTextSelection);
  }
  componentWillUnmount() {
    document.removeEventListener('click', this.checkClickToEdit.bind(this));
    document.removeEventListener('mouseup', this.handleTextSelection);
    document.removeEventListener('keyup', this.handleTextSelection);
  }

  replaceSelectedText = (replacementText) => {
    const { editorState } = this.state;
    let selectionState = this.lastValidSelection || editorState.getSelection();
    const contentState = editorState.getCurrentContent();

    const endKey = selectionState.getEndKey();
    const endOffset = selectionState.getEndOffset();
    const startKey = selectionState.getStartKey();

    if (startKey !== endKey && endOffset === 0) {
      const blockBefore = contentState.getBlockBefore(endKey);
      if (blockBefore) {
        selectionState = selectionState.merge({
          focusKey: blockBefore.getKey(),
          focusOffset: blockBefore.getLength(),
        });
      }
    }

    if (Array.isArray(replacementText)) {
      const startKeyFn = selectionState.getStartKey();
      const endKeyFn = selectionState.getEndKey();
      const blockMap = contentState.getBlockMap();
      const selectedBlocks = [];
      let inSelection = false;

      blockMap.forEach((block, key) => {
        if (key === startKeyFn) inSelection = true;
        if (inSelection) selectedBlocks.push(block);
        if (key === endKeyFn) inSelection = false;
      });

      if (selectedBlocks.length > 1 && selectedBlocks.length === replacementText.length) {
        let newContentState = contentState;
        selectedBlocks.forEach((block, index) => {
          const key = block.getKey();
          const text = replacementText[index];
          let start = 0;
          let end = block.getLength();

          if (key === startKeyFn) {
            start = selectionState.getStartOffset();
          }
          if (key === endKeyFn) {
            end = selectionState.getEndOffset();
          }

          const blockSelection = SelectionState.createEmpty(key).merge({
            anchorKey: key,
            anchorOffset: start,
            focusKey: key,
            focusOffset: end,
          });

          newContentState = Modifier.replaceText(newContentState, blockSelection, text);
        });

        const newEditorState = EditorState.push(editorState, newContentState, 'insert-characters');
        const withFocus = EditorState.forceSelection(newEditorState, newContentState.getSelectionAfter());
        this.setState({ showFloatingAIButton: false });
        this.onChange(withFocus);
        return;
      }
    }

    const textToReplace = Array.isArray(replacementText) ? replacementText.join('\n') : replacementText;
    const newContentState = Modifier.replaceText(contentState, selectionState, textToReplace);
    const newEditorState = EditorState.push(editorState, newContentState, 'insert-characters');
    const withFocus = EditorState.forceSelection(newEditorState, newContentState.getSelectionAfter());
    this.setState({ showFloatingAIButton: false });
    this.onChange(withFocus);
  };

  render() {
    const {
      editorState,
      linksSelected,
      spellCheckEnabled,
      unchanged,
      alignSection,
      focused,
      withTranscriptionIntro,
      showSelectedSuggestionPopup,
      floatingButtonPosition,
    } = this.state;

    const {
      help,
      placeholder,
      area,
      areas,
      search,
      areasLoading,
      onDataChange,
      onDataSelect,
      simpleSearch,
      hideSearch,
      hideSearchBar,
      dataLoading,
      lastJob,
      withAIButton = false,
      variables,
      trackEvent,
      isMobile,
      id,
      ariaLabelledBy,
      ariaLabel,
      resume,
      item,
      type,
      width,
      t,
      router: {
        query: { step },
      },
    } = this.props;

    const withTranscription = this.withTranscriptionFeature();
    const hidePlaceholder =
      editorState && editorState.getCurrentContent().getBlockMap().first().getType() !== 'unstyled';
    const withUndoRedo = isMobile;
    const setEditorState = (newEditorState) => {
      this.setState({ editorState: newEditorState });
      this.onChange(newEditorState);
    };

    const showEducationAI = step === 'education' && width < 450;

    const activeAIVar = marvelEmitter.getActiveVariant('exp_ai_selection_suggestion');
    const showSelectionAIExp = ['ai_selection', 'ai_selection_with_spelling'].includes(activeAIVar) && width > 980;
    const showSpellingCheck = activeAIVar === 'ai_selection_with_spelling' && width > 980;
    return (
      <Wrap
        ref={(el) => (this.editorWrapper = el)}
        onFocus={this.onFocus}
        onBlur={this.onBlur}
        hideSearch={hideSearch}
        active={focused}
        withAIButton={withAIButton}
        isMobile={isMobile}
      >
        <LeftSide hidePlaceholder={hidePlaceholder}>
          <Editor
            customStyleMap={styleMap}
            editorState={editorState}
            blockStyleFn={this.getBlockStyle}
            onChange={this.onChange}
            keyBindingFn={this.customKeyBindingFn}
            handleKeyCommand={this.handleKeyCommand}
            placeholder={placeholder}
            ref={this.getEditor}
            handlePastedText={this.handlePastedText}
            spellCheck={spellCheckEnabled}
            key={spellCheckEnabled}
            id={id}
            ariaLabelledBy={ariaLabelledBy}
            ariaLabel={ariaLabel}
          />

          {showEducationAI && <EducationAiSuggestion source={resume} item={item} type={type} />}
          {this.withRealTimeSuggestion() && (
            <RealTimeSuggestion source={resume} item={item} type={type} insertSuggestion={this.insertBulletPoint} />
          )}
          <StyleControls
            editorState={editorState}
            setEditorState={setEditorState}
            toggleInlineStyle={this.toggleInlineStyle}
            toggleBlockType={this.toggleBlockType}
            toggleLink={this.toggleLink}
            toggleSpellCheck={this.toggleSpellCheck}
            linksSelected={linksSelected}
            spellCheckEnabled={spellCheckEnabled}
            alignSection={alignSection}
            changeAlignSection={this.changeAlignSection}
            withUndoRedo={withUndoRedo}
            trackEvent={trackEvent}
            undo={this.undo}
            redo={this.redo}
            withAIButton={withAIButton}
            handleTranscriptCTAClick={this.handleTranscriptCTAClick}
            withTranscription={withTranscription}
            changeNewSpellCheckStatus={this.changeNewSpellCheckStatus}
          />
          {showSelectedSuggestionPopup && showSelectionAIExp && (
            <SelectionAIPopup
              onClose={this.handleCloseSelectionPopup}
              openState={showSelectedSuggestionPopup}
              updateValue={this.replaceSelectedText}
              resumeId={resume.id}
              resumeLang={resume?.settings?.language || 'en'}
            />
          )}
          {withTranscription && (
            <TranscriptionModal
              open={this.state.transcriptModalOpen}
              setOpen={this.setTranscriptModalOpen}
              insertParagraph={this.insertParagraph}
              item={item}
              recordingBlob={this.state.recordingBlob}
              recordingDuration={this.state.recordingDuration}
              type={type}
              source={resume}
              withTranscriptionIntro={withTranscriptionIntro}
            />
          )}
        </LeftSide>
        {this.state.showFloatingAIButton && (showSpellingCheck || showSelectionAIExp) && (
          <FloatingGroup
            $topCss={floatingButtonPosition?.top || 0}
            $leftCss={floatingButtonPosition?.left || 0}
            onMouseDown={(e) => e.preventDefault()}
          >
            {showSpellingCheck && (
              <FloatingAISelectionCTA onClick={this.handleSpellingCheckClick} spelling={true}>
                <SpellingCheckIcon />
                <FloatingTxt>{t('generator.correct_spelling_ai')}</FloatingTxt>
              </FloatingAISelectionCTA>
            )}
            {showSelectionAIExp && (
              <FloatingAISelectionCTA onClick={this.handleFloatingButtonClick} spelling={false}>
                <SelectionAISvg />
                <FloatingTxt>{t('new_checkout_var_feature_4')}</FloatingTxt>
              </FloatingAISelectionCTA>
            )}
          </FloatingGroup>
        )}

        {!hideSearch && (
          <RightSide>
            <SearchBox
              data={help}
              onSelect={this.onHelpSelect}
              search={search}
              // selectedValues={this.getCurrentPhrases()}
              onDataChange={onDataChange}
              onDataSelect={onDataSelect}
              area={area}
              areas={areas}
              unchanged={unchanged}
              updateUnchanged={this.updateUnchanged}
              areasLoading={areasLoading}
              dataLoading={dataLoading}
              simpleSearch={simpleSearch}
              hideSearchBar={hideSearchBar}
              lastJob={lastJob}
            />
          </RightSide>
        )}
      </Wrap>
    );
  }
}

class StyleButton extends PureComponent {
  static propTypes = {
    onToggle: PropTypes.func,
    style: PropTypes.any,
    title: PropTypes.string,
    active: PropTypes.bool,
  };

  onToggle = (e) => {
    e.preventDefault();
    this.props.onToggle(this.props.style);
  };

  render() {
    const { active, title, style } = this.props;
    return (
      <RichStyleButton title={title} active={active} onMouseDown={this.onToggle}>
        {textAreaIcons(style)}
      </RichStyleButton>
    );
  }
}

class LinkButton extends PureComponent {
  static propTypes = {
    onToggle: PropTypes.func,
    style: PropTypes.any,
    title: PropTypes.string,
    linksSelected: PropTypes.bool,
  };

  onMouseDown = (e) => {
    e.preventDefault();
    this.props.onToggle(this.props.style);
  };

  render() {
    const { linksSelected, title } = this.props;
    return (
      <RichStyleButton title={title} active={linksSelected} onMouseDown={this.onMouseDown}>
        {textAreaIcons(linksSelected ? 'LINK2' : 'LINK')}
      </RichStyleButton>
    );
  }
}

class SpellCheckButton extends PureComponent {
  static propTypes = {
    onToggle: PropTypes.func,
    style: PropTypes.any,
    selected: PropTypes.any,
  };

  onMouseDown = (e) => {
    e.preventDefault();
    this.props.onToggle(this.props.style);
  };

  render() {
    const { selected } = this.props;
    return (
      <SpellCheckButtonContainer active={selected} onMouseDown={this.onMouseDown} title="Spell checker">
        {textAreaIcons('SPELL-CHECK')}
      </SpellCheckButtonContainer>
    );
  }
}

class HoverElementBlock extends PureComponent {
  static propTypes = {
    onClickOutside: PropTypes.func,
    children: PropTypes.node,
  };

  handleClickOutside() {
    this.props.onClickOutside();
  }

  render() {
    const { children } = this.props;
    return <HoverElement>{children}</HoverElement>;
  }
}

const HoverElementAlginSection = onClickOutside(HoverElementBlock);

const StyleControls = (props) => {
  const {
    editorState,
    setEditorState,
    linksSelected,
    toggleLink,
    spellCheckEnabled,
    toggleSpellCheck,
    changeAlignSection,
    alignSection,
    withUndoRedo,
    trackEvent,
    undo,
    redo,
    withAIButton,
    isMobile,
    handleTranscriptCTAClick,
    withTranscription,
    newSpellCheckEnabled,
    changeNewSpellCheckStatus,
  } = props;
  const selection = editorState.getSelection();
  const { t } = intlHook();
  const block = editorState.getCurrentContent().getBlockForKey(selection.getStartKey());
  const blockType = block && block.getType();

  const isEditorEmpty = useMemo(() => {
    const contentState = editorState.getCurrentContent();
    const plainText = contentState.getPlainText().trim();
    const hasText = contentState.hasText();
    return !hasText || plainText === '';
  }, [editorState]);
  const getActiveCurrentStyle = (type) => {
    try {
      const currentInlineStyle = editorState.getCurrentInlineStyle();
      if (type.label === 'Linethrough') {
        return currentInlineStyle.has('LINETHROUGH') || currentInlineStyle.has('STRIKETHROUGH');
      }
      return currentInlineStyle.has(type.style);
    } catch (e) {
      return false;
    }
  };

  const canUndo = editorState.getUndoStack().size > 0;
  const canRedo = editorState.getRedoStack().size > 0;

  const getNextUndoRedoPlainText = (editorState, isUndo = true) => {
    const stack = isUndo ? editorState.getUndoStack() : editorState.getRedoStack();
    if (stack.size > 0) {
      const nextState = stack.peek();
      return nextState.getPlainText();
    }
    return null;
  };

  const handleUndo = () => {
    if (canUndo) trackEvent('textarea_editor', 'undo');
    setEditorState(undo(editorState, getNextUndoRedoPlainText(editorState) === '' ? 2 : 1));
  };

  const handleRedo = () => {
    if (canRedo) trackEvent('textarea_editor', 'redo');
    setEditorState(redo(editorState, getNextUndoRedoPlainText(editorState, false) === '' ? 2 : 1));
  };

  const handleSpellCheckAiClick = (e) => {
    e.preventDefault();
    if (isEditorEmpty) return;
    changeNewSpellCheckStatus(true);
  };

  return (
    <RichControlls data-draft-buttons withAIButton={withAIButton} isMobile={withUndoRedo}>
      <StyleButtonsGroup withUndoRedo={withUndoRedo}>
        {INLINE_STYLES.map((type) => (
          <StyleButton
            key={type.label}
            active={getActiveCurrentStyle(type)}
            label={type.label}
            onToggle={props.toggleInlineStyle}
            style={type.style}
            title={type.title}
          />
        ))}
      </StyleButtonsGroup>
      <StyleButtonsGroup withUndoRedo={withUndoRedo}>
        {BLOCK_TYPES.map((type) => (
          <StyleButton
            key={type.label}
            active={type.style === blockType}
            label={type.label}
            onToggle={props.toggleBlockType}
            style={type.style}
            title={type.title}
          />
        ))}
      </StyleButtonsGroup>
      <StyleButtonsGroup withUndoRedo={withUndoRedo}>
        <LinkButton linksSelected={linksSelected} onToggle={toggleLink} style={'LINK'} title={'Insert link'} />
        {!newSpellCheckEnabled && (
          <SpellCheckButton selected={spellCheckEnabled} onToggle={toggleSpellCheck} style={'UNDERLINE'} />
        )}
      </StyleButtonsGroup>
      <StyleButtonsGroup withUndoRedo={withUndoRedo}>
        {alignSection && (
          <HoverElementAlginSection className="align-section" onClickOutside={changeAlignSection}>
            {ALIGN_TYPES.map((type, index) => (
              <StyleButton
                key={type.label}
                active={type.style === blockType}
                label={type.label}
                onToggle={props.toggleBlockType}
                style={type.style}
                title={type.title}
                child={index === 0}
              />
            ))}
          </HoverElementAlginSection>
        )}
        <RichStyleButton title={ALIGN_TYPES[0].title} active={ALIGN_TYPES[0].active} onClick={changeAlignSection}>
          {textAreaIcons('left-align')}
        </RichStyleButton>
      </StyleButtonsGroup>
      {withUndoRedo && (
        <StyleButtonsGroup withUndoRedo={withUndoRedo} undoRedoIcon>
          <RichStyleButton
            title="Undo"
            style={{ transform: 'rotateY(180deg)', padding: '0 2px 0 2px' }}
            onClick={handleUndo}
            disabled={!canUndo}
          >
            {textAreaIcons('ROTATE')}
          </RichStyleButton>
          <RichStyleButton title="Redo" onClick={handleRedo} disabled={!canRedo} style={{ padding: '0 2px 0 2px' }}>
            {textAreaIcons('ROTATE')}
          </RichStyleButton>
        </StyleButtonsGroup>
      )}
      <SpellCheckAIButtonContainer>
        {newSpellCheckEnabled && (
          <SpellCheckAIButton $disabled={isEditorEmpty} onClick={handleSpellCheckAiClick} title="Spell checker">
            {textAreaIcons('SPELL-CHECK-V2')}
            {t('review_suggetion.check_mistake')}
          </SpellCheckAIButton>
        )}
      </SpellCheckAIButtonContainer>
      {withTranscription && (
        <TranscriptionButtonContainer>
          <TranscriptionButton onClick={handleTranscriptCTAClick} title="Transcript AI">
            {textAreaIcons('RECORDING')}
            {t('generator.transcript_cta_text')}
            <span>{t('generator.transcript_cta_ai_label')}</span>
          </TranscriptionButton>
        </TranscriptionButtonContainer>
      )}
    </RichControlls>
  );
};

StyleControls.propTypes = {
  editorState: PropTypes.any,
  setEditorState: PropTypes.func,
  linksSelected: PropTypes.bool,
  toggleLink: PropTypes.func,
  spellCheckEnabled: PropTypes.bool,
  toggleSpellCheck: PropTypes.func,
  changeAlignSection: PropTypes.func,
  alignSection: PropTypes.bool,
  toggleInlineStyle: PropTypes.func,
  toggleBlockType: PropTypes.func,
  withUndoRedo: PropTypes.bool,
  trackEvent: PropTypes.func,
};

const SpellCheckAIButton = styled.button`
  flex-shrink: 0;
  gap: 4px;
  align-items: center;
  justify-content: center;
  background: #fff;
  box-shadow: 0px 5px 21px 0px rgba(20, 20, 31, 0.12);
  position: relative;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  height: 40px;
  padding: 16px 20px;
  display: flex;
  width: 100%;
  min-width: 163px;
  line-height: 20px;
  color: #008b5d;
  font-family: ${({ theme }) => theme.font.family.websiteSemiBold};
  font-size: 13px;
  font-style: normal;
  font-weight: 400;
  line-height: 20px;
  z-index: 99;
  &:hover {
    background-color: #fcfcfc;
  }
  &:active {
    background-color: #f5f5f5;
  }
  ${({ $disabled }) =>
    $disabled &&
    `
        pointer-event:none;
        background-color: #dbdee9;
        cursor:not-allowed;
        &:hover {
          background-color: #dbdee9;
        }
        color: #8d93a5 !important;
        svg path{
            fill: #8d93a5;
        }
  `}
`;

const textAreaIcons = (icon) => {
  let res = null;
  switch (icon) {
    case 'RECORDING':
      res = <SvgIcon.Recording />;
      break;
    case 'BOLD':
      res = <SvgIcon.Bold />;
      break;
    case 'ITALIC':
      res = <SvgIcon.Italic />;
      break;
    case 'UNDERLINE':
      res = <SvgIcon.Underline />;
      break;
    case 'LINETHROUGH':
      res = <SvgIcon.Strike />;
      break;
    case 'ordered-list-item':
      res = <SvgIcon.OrderedList />;
      break;
    case 'unordered-list-item':
      res = <SvgIcon.UnorderedList />;
      break;
    case 'LINK':
      res = <SvgIcon.Link />;
      break;
    case 'LINK2':
      res = <SvgIcon.LinkDisabled />;
      break;
    case 'SPELL-CHECK':
      res = <SvgIcon.SpellCheck />;
      break;
    case 'ROTATE':
      res = <SvgIcon.Rotate />;
      break;
    case 'left-align':
      res = <AlignSvgIcon.LeftAlign />;
      break;
    case 'center-align':
      res = <AlignSvgIcon.CenterAlign />;
      break;
    case 'right-align':
      res = <AlignSvgIcon.RightAlign />;
      break;
    case 'justify-align':
      res = <AlignSvgIcon.JustifyAlign />;
      break;
    case 'SPELL-CHECK-V2':
      res = (
        <svg width={17} height={16} viewBox="0 0 17 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M4.92367 12.3668L12.7831 5.03127L11.598 3.92514L3.73853 11.2607V12.3668H4.92367ZM5.6179 13.9311L15.1534 5.03127L11.598 1.71289L2.0625 10.6127L2.0625 13.9311H5.6179Z"
            fill="#008B5D"
          />
        </svg>
      );
      break;
  }
  return res;
};

const findLinkEntities = (contentBlock, callback, contentState) => {
  contentBlock.findEntityRanges((character) => {
    const entityKey = character.getEntity();
    return entityKey !== null && contentState.getEntity(entityKey).getType() === 'LINK';
  }, callback);
};

const TIP_REGEX = /\[.*?]/g;

const findTipEntities = (contentBlock, callback) => {
  const text = contentBlock.getText();
  let matchArr, start;
  while ((matchArr = TIP_REGEX.exec(text)) !== null) {
    start = matchArr.index;
    callback(start, start + matchArr[0].length);
  }
};

const Link = (props) => {
  const { url } = props.contentState.getEntity(props.entityKey).getData();
  return <a href={url}>{props.children}</a>;
};

Link.propTypes = {
  contentState: PropTypes.any,
  entityKey: PropTypes.any,
  children: PropTypes.node,
};

const inputStyle = css`
  position: relative;
  display: block;
  background-color: var(--light-values-white);
  line-height: 1.7;
  width: 100%;
  overflow: hidden;
  font-size: 16px;
  color: #282b32;
  height: auto !important;
  border-radius: 3px;
  border: solid 2px #e6e6ff;
  padding: 15px 40% 15px 15px;

  ${({ theme, isMobile }) =>
    theme.designV2 &&
    css`
      border-radius: 8px;
      padding: 20px 15px 0px 15px;
      border: solid 1px #e3e3e4;
      ${(p) =>
        p.withAIButton &&
        isMobile &&
        css`
          padding: 20px 15px;
        `}
    `}

  ${({ active }) =>
    active &&
    css`
      border-color: #1688fe;
    `}
`;

const Wrap = styled.div`
  ${inputStyle}
  cursor: text;
  position:relative;
  @media (max-width: 1024px) {
    overflow: unset;
    height: fit-content;
  }

  ${({ hideSearch }) =>
    hideSearch &&
    css`
      padding-right: 15px;
    `}

  .public-DraftEditor-content {
    height: 250px;
    overflow: auto;
    font-size: 12px;
    color: ${(p) => p.theme.colors.black};
    padding: 0 5px;

  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      padding-right: 0;
    `}

    ${(p) =>
      p.withAIButton &&
      css`
        height: 225px;
        margin-bottom: 25px;
      `}
    ${(p) =>
      p.theme.max('sm')`
         font-size: 15px;
         height: 125px !important;
    `}

    &::-webkit-scrollbar-track {
      border-radius: 2px;
      background-color: ${(p) => p.theme.colors.gray.light};
    }

    &::-webkit-scrollbar {
      width: 3px;
      border-radius: 2px;
      background-color: ${(p) => p.theme.colors.gray.light};
    }

    &::-webkit-scrollbar-thumb {
      border-radius: 2px;
      background-color: #1688fe;
      height: 100px;
    }
    & ul {
      padding-left: 0;
    }
    & ol {
      padding-left: 0;
    }
    & ul {
      list-style: none;
    }
    & ul li {
      display: flex;
      position: relative;
    }
    & ul li::before {
      content: '\2022';
      color: '#1688fe';
      font-weight: bold;
      display: inline-block;
      width: 1em;
      margin-left: -1em;
      font-size: 20px;
      top: -5px;
      position: absolute;
    }
  }
  .public-DraftEditorPlaceholder-root {
    font-size: 12px;
    padding-left: 8px;
    ${({ theme: { isRTL } }) =>
      isRTL &&
      css`
        padding-left: 0;
        padding-right: 8px;
      `}
    ${(p) =>
      p.theme.max('sm')`
      font-size: 15px;
   `}
  }
  ${(p) => p.theme.max('xs')`
    height: auto;
    .public-DraftEditor-content {
      height: 168px;
    }
  `};
  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      div {
        direction: rtl;
        text-align: right;
      }
    `}
  .right-align div {
    text-align: right;
  }
  .center-align div {
    text-align: center;
  }
  .left-align div {
    text-align: left;
  }
  .justify-align div {
    text-align: justify;
    white-space: pre-line;
  }
`;

const RichControlls = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  align-items: center;
  user-select: none;
  margin-bottom: 5px;
  row-gap: 8px;
`;

const RichStyleButton = styled.span`
  width: 26px;
  height: 24px;
  cursor: ${({ disabled }) => (disabled ? 'default' : 'pointer')};
  padding: 2px 0;
  display: inline-block;
  ${({ $center }) =>
    $center &&
    css`
      display: inline-flex;
      justify-content: center;
    `}
  color: var(--black);

  ${({ disabled }) => disabled && 'opacity: .3;'}

  ${(p) =>
    p.active &&
    !p.disabled &&
    css`
      color: #1688fe;
    `}
  &:hover {
    ${({ disabled }) => !disabled && 'color: #1688fe;'}
  }
  ${({ $recording }) =>
    $recording &&
    css`
      padding: 0;
    `}
`;

const SpellCheckButtonContainer = styled(RichStyleButton)`
  transform: scale(0.8);
`;

const StyleButtonsGroup = styled.div`
  flex-shrink: 0;
  display: flex;
  margin-right: ${({ withUndoRedo }) => (withUndoRedo ? 6 : 5)}px;
  position: relative;
  ${(p) => p.theme.max('sm')`
    margin-right: 0;
  `};
  ${(p) => p.theme.max('xs')`
    margin-right: 0;
  `};
  ${({ theme: { isRTL }, withUndoRedo }) =>
    isRTL &&
    css`
      margin-right: 0;
      margin-left: ${withUndoRedo ? 10 : 5}px;

      ${(p) => p.theme.max('sm')`
        margin-left: 0;
      `};
    `}
  ${({ undoRedoIcon }) =>
    undoRedoIcon &&
    css`
      svg {
        width: 17px;
      }
    `}
`;

const LeftSide = styled.div`
  padding-right: 15px;
  width: 100%;
  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      padding-right: 0;
    `}
  .public-DraftStyleDefault-unorderedListItem {
    :before {
      margin-left: -18px;
      top: -3px;
    }
    ${({ theme: { isRTL } }) =>
      isRTL &&
      css`
        margin-left: 0;
        margin-right: 1.5em;
        direction: rtl;
        &:before {
          margin-left: 0;
          margin-right: -18px;
          right: 0;
        }
      `}
  }

  .public-DraftStyleDefault-orderedListItem {
    :before {
      top: 2px;
    }

    ${({ theme: { isRTL } }) =>
      isRTL &&
      css`
        margin-left: 0;
        margin-right: 1.5em;
        direction: ${isRTL ? 'rtl' : 'ltr'};
        &:before {
          right: -36px;
          text-align: ${isRTL ? 'left' : 'right'} !important;
        }
      `}
  }

  .public-DraftStyleDefault-ul {
    margin: 0px
      ${({ theme: { isRTL } }) =>
        isRTL &&
        css`
          direction: ltr;
        `};
  }

  .public-DraftStyleDefault-ol {
    ${({ theme: { isRTL } }) =>
      isRTL &&
      css`
        direction: ltr;
      `}
  }
  ${(p) => p.theme.max('xs')`
    padding-right: 0;
  `};

  .public-DraftEditorPlaceholder-root,
  .public-DraftStyleDefault-block {
    font-family: ${({ theme }) => theme.font.family.websiteMedium};
    font-size: 15px;
    color: #484870;
    letter-spacing: normal;
    line-height: 1.53;
  }

  .public-DraftEditorPlaceholder-root {
    font-weight: bold;
  }
  .public-DraftStyleDefault-block a {
    color: #0000ee;
  }

  .public-DraftEditorPlaceholder-root {
    margin-left: 5px;
    line-height: normal;
    opacity: 0.3;
  }

  .public-DraftStyleDefault-block {
    .public-DraftStyleDefault-unorderedListItem:before {
      background: green;
      margin-left: -18px;
      top: -5px;
    }
  }

  ${({ hidePlaceholder }) =>
    hidePlaceholder &&
    css`
      .public-DraftEditorPlaceholder-root {
        display: none;
      }
    `}
`;

const RightSide = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  width: 40%;
  height: 100%;
  background-color: #f6f6f7;

  ${(p) => p.theme.max('lg')`
    position: relative;
    width: 100%;
  `};
`;

const HoverElement = styled.div`
  position: absolute;
  top: -35px;
  left: -50px;
  display: flex;
  align-items: center;
  background: #fff;
  z-index: 999;
  width: 114px;
  height: 30px;
  border-radius: 3px;
  box-shadow: 0 2px 4px 0;
  padding: 6px 0px 6px 10px;
`;

const SpellCheckAIButtonContainer = styled(StyleButtonsGroup)``;

const TranscriptionButtonContainer = styled(StyleButtonsGroup)`
  width: 100%;
  margin-bottom: 4px;
`;

const TranscriptionButton = styled.button`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 3px;
  align-self: stretch;
  flex-shrink: 0;

  width: 100%;
  height: 40px;
  padding: 16px 20px;

  border: none;
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 5.258px 21.031px 0 rgba(20, 20, 31, 0.12);

  color: #343741;
  font-family: ${({ theme }) => theme.font.family.websiteBold};
  font-size: 13px;
  line-height: 19px;

  span {
    padding: 2px 8px;
    border-radius: 4px;
    background: #4285f4;
    color: #fff;
    font-family: ${({ theme }) => theme.font.family.websiteSemiBold};
    font-size: 12px;
    line-height: 15px;
  }
`;

const FloatingGroup = styled(Flex)`
  position: absolute;
  z-index: 1000;
  gap: 8px;
  transform: translateY(-100%);
  transition: all 0.1s ease-out;

  ${({ $topCss, $leftCss }) => css`
    ${$topCss &&
    css`
      top: ${$topCss}px;
    `}
    ${$leftCss &&
    css`
      left: ${$leftCss}px;
    `}
  `}
`;

const FloatingAISelectionCTA = styled(Flex)`
  align-items: center;
  justify-content: center;
  border-radius: 100px;
  background: #0072e8;
  padding: 6px 8px;
  gap: 6px;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);

  ${({ spelling }) => css`
    ${spelling &&
    css`
      background: #008b5d;
      box-shadow: 2px 2px 4px 0 rgba(20, 20, 31, 0.25);
    `}
  `}

  > svg {
    min-height: 14px;
    min-width: 14px;
  }
`;

const FloatingTxt = styled.p`
  color: #fff;
  font-family: ${({ theme }) => theme.font.family.websiteMedium};
  font-size: 12px;
  line-height: normal;
  margin: 0;
`;

export default TextAreaEditor;
