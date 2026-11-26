import { ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { TeamApi } from '@shared/api/team'
import { subscribe } from './subscribe'

/** Mảng B — Team & Quản lý: chấm công, học tập, ý tưởng, feedback, lập kế hoạch, thông báo. */
export const teamApi: TeamApi = {
  ideas: {
    format: (input) => ipcRenderer.invoke(IPC.ideasFormat, input)
  },
  notify: {
    show: (notification) => ipcRenderer.invoke(IPC.notifyShow, notification)
  },
  planner: {
    planTasks: (request) => ipcRenderer.invoke(IPC.plannerPlanTasks, request)
  },
  feedback: {
    coach: (request) => ipcRenderer.invoke(IPC.feedbackCoach, request),
    summarize: (request) => ipcRenderer.invoke(IPC.feedbackSummarize, request)
  },
  time: {
    current: () => ipcRenderer.invoke(IPC.timeCurrent),
    start: (input) => ipcRenderer.invoke(IPC.timeStart, input),
    stop: () => ipcRenderer.invoke(IPC.timeStop),
    list: (from, to) => ipcRenderer.invoke(IPC.timeList, { from, to }),
    addManual: (input) => ipcRenderer.invoke(IPC.timeAddManual, input),
    update: (input) => ipcRenderer.invoke(IPC.timeUpdate, input),
    remove: (id) => ipcRenderer.invoke(IPC.timeRemove, id),
    exportCsv: (input) => ipcRenderer.invoke(IPC.timeExportCsv, input),
    onChanged: (listener) => subscribe<void>(IPC.timeChanged, listener),
    getWorkday: () => ipcRenderer.invoke(IPC.settingsGetWorkday),
    setWorkday: (workday) => ipcRenderer.invoke(IPC.settingsSetWorkday, workday)
  },
  learning: {
    planPath: (request) => ipcRenderer.invoke(IPC.learningPath, request),
    makeQuiz: (request) => ipcRenderer.invoke(IPC.learningQuiz, request),
    grade: (request) => ipcRenderer.invoke(IPC.learningGrade, request),
    suggestMemory: (content, category) =>
      ipcRenderer.invoke(IPC.memorySuggest, { content, category })
  },
  dayPlanner: {
    plan: (request) => ipcRenderer.invoke(IPC.plannerDay, request),
    report: (request) => ipcRenderer.invoke(IPC.plannerReport, request)
  }
}
