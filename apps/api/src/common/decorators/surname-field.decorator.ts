import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, registerDecorator } from 'class-validator';

export const SURNAME_BLANK_MESSAGE = "Surname can't be blank.";
export const SURNAME_WITH_ONE_NAME_MESSAGE = 'Leave the surname empty for someone who has only one name.';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A surname, which may be empty only for someone who has only one name
 * (Decision 434, TXT-8): the form's "Has only one name" tick sends
 * `hasOnlyOneName: true` with `surname: ''`. Without the tick a blank surname
 * is refused as before, so nobody has to type "." or "-" for a mononym. The
 * column stays NOT NULL; an empty string is the one name's empty surname.
 * Pair with `@HasOnlyOneNameField()` on the same DTO.
 */
export function SurnameField(options: { optional?: boolean } = {}) {
  return applyDecorators(
    options.optional ? ApiPropertyOptional({ description: "Empty only with hasOnlyOneName: true." }) : ApiProperty({ description: "Empty only with hasOnlyOneName: true." }),
    ...(options.optional ? [IsOptional()] : []),
    Transform(trim),
    IsString(),
    MaxLength(100),
    (target: object, propertyName: string | symbol) => {
      registerDecorator({
        name: 'surnameOrOnlyOneName',
        target: target.constructor,
        propertyName: propertyName as string,
        validator: {
          validate: (value: unknown, args) => {
            if (typeof value !== 'string') return true; // IsString reports it
            const oneName = (args?.object as { hasOnlyOneName?: unknown } | undefined)?.hasOnlyOneName === true;
            return oneName ? value === '' : value !== '';
          },
          defaultMessage: (args) =>
            (args?.object as { hasOnlyOneName?: unknown } | undefined)?.hasOnlyOneName === true ? SURNAME_WITH_ONE_NAME_MESSAGE : SURNAME_BLANK_MESSAGE,
        },
      });
    },
  );
}

/** The "Has only one name" tick (Decision 434, TXT-8). Not stored: an empty
 * surname is what records it. */
export function HasOnlyOneNameField() {
  return applyDecorators(
    ApiPropertyOptional({ description: 'True for someone who has only one name; the surname is then sent empty.' }),
    IsOptional(),
    IsBoolean(),
  );
}
