import { create } from 'zustand';

export const useAISelectionStore = create((set) => ({
  selectedValue: null,
  selectedDisplayHTML: null,
  selectionList: [],
  aiState: {
    selectedTitle: null,
    inputValue: '',
    loading: false,
    aiOutPut: null,
  },
  setSelectedValue: (selectedValue, selectedDisplayHTML = null, selectionList = []) =>
    set({ selectedValue, selectedDisplayHTML, selectionList }),
  updateAIState: (partialState) =>
    set((state) => ({
      aiState: { ...state.aiState, ...partialState },
    })),

  resetAIState: () =>
    set({
      aiState: {
        selectedTitle: null,
        inputValue: '',
        loading: false,
        aiOutPut: null,
      },
    }),
}));
