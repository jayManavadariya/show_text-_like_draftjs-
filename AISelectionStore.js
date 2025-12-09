import { create } from 'zustand';

export const useAISelectionStore = create((set) => ({
  selectedValue: null,
  selectedEditorState: null,
  aiState: {
    selectedTitle: null,
    inputValue: '',
    loading: false,
    aiOutPut: null,
  },
  setSelectedValue: (selectedValue) => set({ selectedValue }),
  setSelectedEditorState: (selectedEditorState) => set({selectedEditorState}),
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
