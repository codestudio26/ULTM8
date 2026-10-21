export const disciplines = {
  list: {
    title: 'Disciplines',
    subtitle: 'The martial arts / activities your School offers — Instructors and Classes both reference these.',
    startFromTemplate: 'Start from template',
    addButton: 'Add discipline',
    loadFailed: 'Could not load Disciplines.',
    emptyTitle: 'No Disciplines yet',
    emptyDescription: 'Add your first Discipline to get started.',
    columnName: 'Name',
    columnClassTypes: 'Class types offered',
    manageSkills: 'Manage skills',
    edit: 'Edit',
    duplicate: 'Duplicate',
    delete: 'Delete',
    deleteAria: 'Delete {name}',
    addTitle: 'Add discipline',
    editTitle: 'Edit discipline',
    deleteTitle: 'Delete {name}?',
    deleteDescription:
      'Its belts, skills and coach permissions are deleted with it. A style can only be deleted while nobody has a rank in it and no class or lesson uses it.',
  },
  detail: {
    loadFailed: 'Could not load this Discipline.',
    skillsLoadFailed: 'Could not load Skills.',
    ranksLoadFailed: 'Could not load Ranks.',
    fallbackTitle: 'Discipline',
    skillsHeading: 'Skills',
    skillsIntro: 'Named Skills a Student can be signed off on within this Discipline.',
    addSkill: 'Add skill',
    emptyTitle: 'No Skills yet',
    emptyDescription: 'Add your first Skill to get started.',
    columnName: 'Name',
    columnDescription: 'Description',
    edit: 'Edit',
    delete: 'Delete',
    deleteAria: 'Delete {name}',
    addSkillTitle: 'Add skill',
    editSkillTitle: 'Edit skill',
    deleteTitle: 'Delete {name}?',
    deleteDescription:
      'It comes off the stripes and lessons that list it. A skill can only be deleted while no student has been marked on it.',
  },
  template: {
    title: 'Start from a template',
    intro:
      "Creates a new style with the template's belts, stripes, classes, minimum days and class types. You can change any of it afterwards.",
    templateLegend: 'Template',
    nameLabel: 'Style name',
    nameHint: "Leave blank to use the template's name.",
    create: 'Create style',
    /** The API's three IBJJF templates (apps/api ranks/templates/ibjjf.ts), by id. */
    options: {
      ibjjf: {
        name: 'IBJJF Adult & Kid (White Stripes)',
        description: 'Kids belts with white stripes, adult belts, black belt degrees. 90 grades (each belt and each stripe).',
      },
      ibjjf_kids_red: {
        name: 'IBJJF Adult & Kid (White & Red Stripes)',
        description: 'As the White Stripes ladder, plus red stripes on the kids belts. 139 grades (each belt and each stripe).',
      },
      ibjjf_kids_yellow: {
        name: 'IBJJF Adult & Kid (Yellow Stripes)',
        description: 'As the White & Red Stripes ladder, plus yellow stripes on the kids belts. 175 grades (each belt and each stripe).',
      },
    },
  },
  duplicate: {
    title: 'Duplicate {name}',
    description:
      'Creates "{copyName}" with the same belts, stripes and their rules, skills, class types, "skills required" setting and board columns. No students, ranks or coach permissions are copied.',
    confirm: 'Duplicate',
  },
  form: {
    nameLabel: 'Discipline name',
    classTypesLabel: 'Class types offered',
    classTypesHint: 'Comma-separated, e.g. "Kids Fundamentals, Adult Sparring, Competition Team"',
    skillsRequired:
      'Skills required to grade: block grading until every skill for the next rank is signed off (otherwise the coach can grade with a written acknowledgement)',
  },
  stylePicker: {
    style: 'Style',
    styleNumbered: 'Style {number}',
    selectStyle: 'Select a style…',
    classType: 'Class type',
    selectClassType: 'Select a class type…',
    remove: 'Remove',
    addAnother: 'Add another style',
    noneChosen: 'Choose at least one style.',
    emptyRow: 'Choose a style on every row.',
    listedTwice: '"{name}" is listed twice.',
    classTypeMissing: 'Choose a class type for "{name}".',
  },
};
