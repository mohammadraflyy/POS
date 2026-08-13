ALTER TABLE `product_units` ADD `parent_unit_id` integer REFERENCES product_units(id);--> statement-breakpoint
-- Until now the units of a product formed one strict chain, ordered by conversion_factor:
-- each derived unit was implicitly measured in the one directly below it. Making that link
-- explicit is what allows siblings later (a SAK and a RENTENG both holding pieces), so the
-- backfill has to reproduce exactly the chain that was implied, or every conversion moves.
UPDATE `product_units`
SET `parent_unit_id` = (
  SELECT `prev`.`id`
  FROM `product_units` AS `prev`
  WHERE `prev`.`product_id` = `product_units`.`product_id`
    AND `prev`.`is_base_unit` = 0
    AND `prev`.`conversion_factor` < `product_units`.`conversion_factor`
  ORDER BY `prev`.`conversion_factor` DESC
  LIMIT 1
)
WHERE `is_base_unit` = 0;
