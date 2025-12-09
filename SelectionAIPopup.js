import nookies from 'nookies';
import { darken } from 'polished';
import { Fragment } from 'react';
import styled, { css } from 'styled-components';
import CloseModalIcon from '/imports/coaching/ui/assets/CloseModalIcon';
import { useResponsive } from '/imports/core/api/responsiveContext';
import useIntl from '/imports/core/api/useIntl';
import useTracking from '/imports/core/hooks/useTracking';
import { CheckIcon } from '/imports/core/ui/assets';
import { SendInputIcon, StarBlingkingIcon } from '/imports/core/ui/assets/SelectionAISvg';
import Flex from '/imports/core/ui/atoms/Flex';
import Modal from '/imports/core/ui/atoms/Modal';
import { inputStyle, overrideInputStyleMixin } from '/imports/core/ui/mixins';
import { selectionAIOptimiseProxy } from '/imports/generator/api/openaiApi';
import { Loader } from '/imports/generator/ui/atoms/Loader';
import { isBlogDomain } from '/lib/helpers';
import { useAISelectionStore } from '/zustand/AISelectionStore';

const modalStyles = {
  modalContainer: { display: 'flex', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  modalBackdrop: { backgroundColor: 'rgba(20, 20, 31, 0.48)', opacity: '0.7' },
  modalBody: {
    maxWidth: '628px',
    background: '#FFF',
    boxShadow: '0px 12px 48px 0px rgba(20, 20, 31, 0.24)',
    width: '90%',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: '0',
    maxHeight: '95vh',
  },
};

const AI_ACTION_OPTIONS = [
  { icon: '✨', title: 'Rephrase', key: 'rephrase', slugTitle: 'selection_ai_option_title_1' },
  { icon: '📈', title: 'Make it ATS-oriented', key: 'ats-oriented', slugTitle: 'selection_ai_option_title_2' },
  { icon: '✔️', title: 'Fix grammar', key: 'fix-grammer', slugTitle: 'selection_ai_option_title_3' },
  { icon: '📄', title: 'Make it concise', key: 'make-it-concise', slugTitle: 'selection_ai_option_title_4' },
  { icon: '👔', title: 'Make it more formal', key: 'make-it-formal', slugTitle: 'selection_ai_option_title_5' },
];

const SelectionAIPopup = ({ onClose, openState, updateValue, resumeId, resumeLang }) => {
  const { t } = useIntl();
  const { token } = nookies.get({});
  const { host } = useResponsive();
  const { trackEvent } = useTracking();
  const isBlog = isBlogDomain(host);

  const { selectedValue, selectedEditorState, aiState, updateAIState, resetAIState } = useAISelectionStore();
  const { inputValue, loading, aiOutPut } = aiState;

  const hasResponse = aiOutPut !== null;
  const isSendDisabled = inputValue?.trim() == '' || loading;

  let websiteURL = typeof window !== 'undefined' && window.location.origin;
  if (isBlog) {
    websiteURL += '/builder';
  }

  const handleInputChange = (e) => {
    updateAIState({ inputValue: e.target.value });
  };

  const runAPI = async (payload) => {
    updateAIState({ loading: true });
    const resp = await selectionAIOptimiseProxy(payload, token, websiteURL);
    updateAIState({ aiOutPut: resp.text, loading: false });
  };

  const handleSelect = (title, key) => async () => {
    trackEvent('ai_action_selected', {
      actionType: key,
    });
    updateAIState({ selectedTitle: title });
    runAPI({
      text: selectedValue,
      actionType: key,
      resumeId,
      resumeLang,
    });
  };

  const handleTriggerAPI = async () => {
    const actionType = 'user-defined-prompt';
    trackEvent('ai_action_selected', {
      actionType,
    });
    runAPI({
      actionType,
      userPrompt: inputValue,
      resumeId,
      text: hasResponse ? aiOutPut : selectedValue,
      resumeLang,
    });
    updateAIState({ inputValue: '' });
  };

  const handleReplaceValue = () => {
    trackEvent('selection_ai_added');
    updateValue(aiOutPut);
    resetAIState();
    onClose();
  };

  const apiResponse = () => {
    return <SelectedTxt>{aiOutPut}</SelectedTxt>;
  };
  
  const InitialFlow = () => {
    return (
      <Fragment>
        <SelectedTxt>{selectedEditorState}</SelectedTxt>
        {/* <SelectedTxt>{selectedValue}</SelectedTxt> */}
        <QuickAction $fullWidth $direction="column">
          <ActionTitle>{t('selection_quick_action_title')}</ActionTitle>
          <CTAWrapper>
            {AI_ACTION_OPTIONS.map(({ icon, title, key, slugTitle }) => {
              return (
                <CTA key={title} onClick={handleSelect(title, key)}>
                  {icon && <Flex>{icon}</Flex>}
                  <CTATitle>{t(slugTitle)}</CTATitle>
                </CTA>
              );
            })}
          </CTAWrapper>
        </QuickAction>
      </Fragment>
    );
  };

  return (
    <Modal onClose={onClose} styles={modalStyles} open={openState} animation="empty" timeout={0} noClicker={true}>
      {!loading && (
        <MyContainer $direction="column">
          <MainTitle $alignItems="center">
            <StarBlingkingIcon />
            {t('generate_ai_suggestion_selection_txt')}
          </MainTitle>
          <CloseAbsolute onClick={onClose}>
            <CloseModalIcon fill="white" />
          </CloseAbsolute>
          <Flex $direction="column" $fullWidth>
            <TopWrapper $fullWidth $direction="column" $justifyContent="space-between" $isResp={true}>
              {hasResponse ? (
                <>
                  {apiResponse()}
                  <Border />
                  <GapFlex $fullWidth $alignItems="center" $justifyContent="center" $ctaParent={true}>
                    <ActionCTA $alignItems="center" $justifyContent="center" onClick={onClose}>
                      {t('cancel')}
                    </ActionCTA>
                    <ActionCTA
                      $alignItems="center"
                      $justifyContent="center"
                      $update={true}
                      onClick={handleReplaceValue}
                    >
                      {t('selection_ai_update_cta')} <CheckIcon />
                    </ActionCTA>
                  </GapFlex>
                </>
              ) : (
                InitialFlow()
              )}
            </TopWrapper>
            <BottomWrappeR
              $fullWidth
              $justifyContent={hasResponse ? 'space-between' : 'flex-start'}
              $alignItems="center"
            >
              <GapFlex $fullWidth $alignItems="center">
                <InputField $fullWidth>
                  <PlainInput
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleTriggerAPI();
                      }
                    }}
                    placeholder={t(
                      hasResponse ? 'selection_ai_input_placeholder_v2' : 'selection_ai_input_placeholder',
                    )}
                  />
                  <SendIcon
                    $alignItems="center"
                    $justifyContent="center"
                    $disable={isSendDisabled}
                    onClick={!isSendDisabled ? handleTriggerAPI : undefined}
                  >
                    <SendInputIcon />
                  </SendIcon>
                </InputField>
              </GapFlex>
            </BottomWrappeR>
          </Flex>
        </MyContainer>
      )}
      {loading && (
        <LoadingWrapper $direction="column" $fullWidth $justifyContent="center" $alignItems="center">
          <StyledLoader />
          <LoadingTxt>{t('selection_ai_loading_txt')}</LoadingTxt>
        </LoadingWrapper>
      )}
    </Modal>
  );
};

export default SelectionAIPopup;

const CloseAbsolute = styled(Flex)`
  position: absolute;
  right: 10px;
  top: 16px;
  cursor: pointer;

  > svg {
    min-height: 16px;
    min-width: 16px;
    max-width: 16px;
    max-height: 16px;
  }

  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      right: unset;
      left: 10px;
    `}
`;

const Border = styled.div`
  height: 1px;
  background: #ececed;
  width: 100%;
`;

const MainTitle = styled(Flex)`
  color: #fff;
  font-family: ${({ theme }) => theme.font.family.websiteSemiBold};
  font-size: 20px;
  padding-left: 12px;

  svg {
    margin-right: 8px;
  }
`;

const MyContainer = styled(Flex)`
  border-radius: 8px;
  padding: 16px 4px 4px 4px;
  background: #0072e8;
  gap: 10px;
`;

const ActionCTA = styled(Flex)`
  text-transform: capitalize;
  border-radius: 4px;
  color: #1688fe;
  font-size: 16px;
  font-family: ${({ theme }) => theme.font.family.websiteSemiBold};
  line-height: 24px;
  min-width: 136px;
  padding: 16px 8px;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    color: #1642feed;
  }

  ${({ $update }) =>
    $update &&
    css`
      border-radius: 4px;
      background: #1688fe;
      color: #fff;

      > svg {
        margin-left: 12px;
        width: 16px;
        height: 16px;

        > path {
          stroke: #fff;
        }
      }

      &:hover {
        color: #fff;
        background-color: ${darken(0.05, '#1688fe')};
      }
    `}
`;

const StyledLoader = styled(Loader)`
  margin-top: 20px;
`;

const LoadingTxt = styled.div`
  margin-top: 30px;
  color: #000;
  text-align: center;
  font-size: 18px;
  font-family: ${({ theme }) => theme.font.family.websiteSemiBold};
  line-height: 24px;
`;

const LoadingWrapper = styled(Flex)`
  margin: 0 auto;
  left: 0;
  right: 0;
  padding: 24px 0;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0px 12px 48px 0px rgba(20, 20, 31, 0.24);
  top: calc(50% - 64px);
  z-index: 9999;
`;

const SendIcon = styled(Flex)`
  border-radius: 4px;
  min-height: 28px;
  padding: 4px;
  min-width: 28px;
  position: absolute;
  right: 14px;
  top: 20%;
  z-index: 999999;
  transition: all 0.3s;
  background: #378eff;
  cursor: pointer;

  ${({ $disable }) => css`
    ${$disable &&
    css`
      border-radius: 4px;
      background: #c4c4c7;
      pointer-events: none;
    `}
  `}

  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      right: unset;
      left: 14px;
    `}
`;

const InputField = styled(Flex)`
  position: relative;
`;

const GapFlex = styled(Flex)`
  gap: 5px;
`;

const PlainInput = styled.input`
  ${inputStyle};
  ${overrideInputStyleMixin};
  width: 100%;
  min-height: 40px;
  padding: 10px 12px;
  padding-right: 45px;
  border-radius: 6px;
  color: #0866f5;
  font-family: ${({ theme }) => theme.font.family.websiteMedium};
  font-size: 15px;
  line-height: 22px;

  &:focus {
    border-color: #428eff;
  }

  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      padding-right: 12px;
      padding-left: 45px;
    `}

  ${({ isSelected }) => css`
    ${!isSelected &&
    css`
      color: rgb(0, 0, 0);
    `}
  `}
`;

const BottomWrappeR = styled(Flex)`
  padding: 16px 24px;
  border-radius: 0 0 8px 8px;
  background: #edf4ff;
  gap: 8px;

  ${({ theme: { isRTL } }) =>
    isRTL &&
    css`
      direction: rtl;
    `}
`;

const CTATitle = styled.div`
  color: #272731;
  font-size: 16px;
  font-family: ${({ theme }) => theme.font.family.websiteMedium};
  line-height: 24px;
  transition: all 0.3s;
`;

const CTA = styled(Flex)`
  border-radius: 32px;
  background: #edf4ff;
  padding: 12px 14.5px;
  gap: 10px;
  z-index: 9999;
  cursor: pointer;
  transition: all 0.3s;

  &:hover {
    border-radius: 32px;
    background: #1688fe;

    > div {
      color: #fff;
    }
  }
`;

const CTAWrapper = styled(Flex)`
  gap: 8px;
  flex-wrap: wrap;
`;

const ActionTitle = styled.div`
  color: #606062;
  font-size: 16px;
  font-family: ${({ theme }) => theme.font.family.websiteBold};
  line-height: 24px;
`;

const QuickAction = styled(Flex)`
  gap: 8px;
`;

const SelectedTxt = styled.div`
  color: #3a3a43;
  font-family: ${({ theme }) => theme.font.family.websiteMedium};
  font-size: 16px;
  line-height: 24px;
  max-height: 40vh;
  overflow-y: auto;
  white-space: pre-line;

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
    background-color: #428eff;
  }
`;

const TopWrapper = styled(Flex)`
  gap: 24px;
  background: #fff;
  border-radius: 8px 8px 0 0;
  padding: 16px 24px;

  ${({ theme: { isRTL }, $isResp }) => css`
    ${isRTL &&
    css`
      direction: rtl;
    `}
    ${$isResp &&
    css`
      gap: 16px;
    `}
  `}
`;
