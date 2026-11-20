import { describe, expect, it } from 'vitest'
import type { Project } from '@shared/projects'
import { pinnedProjects, viewProjects } from '../view'

const p = (name: string, extra: Partial<Project> = {}): Project => ({
  id: name,
  name,
  description: '',
  instructions: '',
  pinned: false,
  fileCount: 0,
  createdAt: 0,
  updatedAt: 0,
  ...extra
})

describe('viewProjects', () => {
  const list = [
    p('Ôn thi', { updatedAt: 3, createdAt: 1 }),
    p('Agent', { updatedAt: 1, createdAt: 3, pinned: true }),
    p('Đồ án Unity', { updatedAt: 2, createdAt: 2, description: 'game 2D' })
  ]
  const names = (l: Project[]) => l.map((x) => x.name)

  it('ghim luôn đầu; rồi theo lựa chọn sắp xếp', () => {
    expect(names(viewProjects(list, 'updated', ''))).toEqual(['Agent', 'Ôn thi', 'Đồ án Unity'])
    expect(names(viewProjects(list, 'created', ''))).toEqual(['Agent', 'Đồ án Unity', 'Ôn thi'])
    expect(names(viewProjects(list, 'name', ''))).toEqual(['Agent', 'Đồ án Unity', 'Ôn thi'])
  })

  it('lọc không dấu theo tên + mô tả', () => {
    expect(names(viewProjects(list, 'updated', 'do an'))).toEqual(['Đồ án Unity'])
    expect(names(viewProjects(list, 'updated', 'GAME'))).toEqual(['Đồ án Unity'])
    expect(viewProjects(list, 'updated', 'khong co')).toEqual([])
  })

  it('pinnedProjects', () => {
    expect(names(pinnedProjects([...list, p('Ảnh', { pinned: true })]))).toEqual(['Agent', 'Ảnh'])
  })
})
