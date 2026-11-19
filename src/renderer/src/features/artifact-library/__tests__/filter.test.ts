import { describe, expect, it } from 'vitest'
import type { ArtifactSummary } from '@shared/artifacts'
import { filterArtifacts } from '../filter'

const a = (title: string, conversationTitle: string): ArtifactSummary => ({
  id: title,
  conversationId: 'c',
  title,
  type: 'doc',
  version: 1,
  updatedAt: 0,
  conversationTitle
})
const list = [a('Báo cáo tuần', 'Công việc'), a('GDD', 'Game Unity đồ án'), a('Bảng điểm', 'Học tập')]

describe('filterArtifacts — lọc trang Artifacts', () => {
  it('không dấu, theo tên artifact hoặc tên cuộc trò chuyện, mọi từ đều phải khớp', () => {
    expect(filterArtifacts(list, '').map((x) => x.title)).toEqual(['Báo cáo tuần', 'GDD', 'Bảng điểm'])
    expect(filterArtifacts(list, 'bao cao').map((x) => x.title)).toEqual(['Báo cáo tuần'])
    expect(filterArtifacts(list, 'unity').map((x) => x.title)).toEqual(['GDD'])
    expect(filterArtifacts(list, 'do an gdd').map((x) => x.title)).toEqual(['GDD'])
    expect(filterArtifacts(list, 'bang  HOC').map((x) => x.title)).toEqual(['Bảng điểm'])
    expect(filterArtifacts(list, 'khong co')).toEqual([])
  })
})
